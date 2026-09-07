import {
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  isPdfString,
  pdfRefKey,
  type PdfDictionary,
  type PdfName,
  type PdfRef,
  type PdfStream,
  type PdfString,
  type PdfValue
} from "./nativeCos";
import { type NativePdfDocument } from "./nativeDocument";
import type { NativeOptionalContentRegistry } from "./nativeOptionalContent";
import {
  PdfError,
  type PdfDiagnostic,
  throwIfAborted
} from "./nativeTypes";

export type NativePdfMatrix = readonly [number, number, number, number, number, number];
export type NativePdfRectangle = readonly [number, number, number, number];

export interface NativePdfTransparencyGroup {
  readonly subtype: "Transparency";
  readonly isolated: boolean;
  readonly knockout: boolean;
  /** Resolved outer color-space object; nested indirect values remain lazy. */
  readonly colorSpace?: PdfValue;
}

export type NativePdfResourceOrigin = "local" | "inherited" | "empty";

/** A validated, reusable Form XObject definition. Content is decoded lazily. */
export interface NativePdfForm {
  /** Stable source-object identity. The same stream has the same id in every scope. */
  readonly id: string;
  readonly ref: PdfRef | null;
  readonly dictionary: PdfDictionary;
  readonly bbox: NativePdfRectangle;
  readonly matrix: NativePdfMatrix;
  readonly resources: PdfDictionary;
  readonly resourceOrigin: NativePdfResourceOrigin;
  /** Raw Form-level optional-content association, evaluated by the program graph. */
  readonly optionalContent?: PdfValue;
  readonly group?: NativePdfTransparencyGroup;
  readonly encodedContentBytes: number;
}

/**
 * One invocation of a reusable Form. The ancestry is kept separate from the
 * cached definition so legal reuse does not look recursive.
 */
export interface NativePdfFormInvocation {
  readonly form: NativePdfForm;
  readonly depth: number;
  readonly ancestry: readonly string[];
}

export interface NativePdfAcroFormMetadata {
  readonly dictionary: PdfDictionary;
  /** Top-level field values in source order. Descendants remain lazy. */
  readonly fields: readonly PdfValue[];
  readonly needAppearances: boolean;
  readonly signatureFlags: number;
  readonly defaultResources?: PdfDictionary;
  readonly defaultAppearance?: PdfString;
  readonly quadding?: 0 | 1 | 2;
  readonly fieldCount: number;
}

export interface NativePdfWidgetMetadata {
  readonly fieldType?: string;
  readonly partialNames: readonly string[];
  readonly fullyQualifiedName?: string;
  readonly value?: PdfValue;
  readonly defaultValue?: PdfValue;
  readonly fieldFlags: number;
  readonly defaultAppearance?: PdfString;
  readonly quadding?: 0 | 1 | 2;
  /** Inherited positive `/MaxLen` for text fields. */
  readonly maxLength?: number;
  /** Resolved `/Opt` entries in source order for choice fields. */
  readonly choiceOptions?: readonly NativePdfChoiceOption[];
  /** Resolved, strictly increasing `/I` indexes for choice fields. */
  readonly selectedChoiceIndices?: readonly number[];
  /** First visible list-box option from inherited `/TI`. */
  readonly topChoiceIndex?: number;
  readonly acroForm: NativePdfAcroFormMetadata | null;
}

export interface NativePdfChoiceOption {
  /** Value stored in `/V`; identical to `displayValue` for one-string entries. */
  readonly exportValue: PdfString;
  /** Human-readable option label. */
  readonly displayValue: PdfString;
}

export interface NativePdfAnnotationAppearance {
  readonly id: string;
  readonly pageIndex: number;
  readonly annotationIndex: number;
  readonly ref: PdfRef | null;
  readonly dictionary: PdfDictionary;
  readonly subtype: string;
  readonly rectangle: NativePdfRectangle;
  readonly flags: number;
  readonly visibleInDefaultView: boolean;
  readonly appearanceState?: string;
  readonly hasAppearanceDictionary: boolean;
  readonly optionalContent?: PdfValue;
  readonly widget?: NativePdfWidgetMetadata;
}

export interface NativePdfResolvedAnnotationAppearance {
  readonly annotation: NativePdfAnnotationAppearance;
  readonly normalAppearance: NativePdfFormInvocation;
  readonly stateName?: string;
  readonly optionalContentIndex: number;
}

export interface NativePdfFormAppearanceRegistryOptions {
  /** May lower, but never raise, the document object-recursion ceiling. */
  readonly maxFormDepth?: number;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  /** Required to evaluate annotations carrying an /OC association. */
  readonly optionalContent?: NativeOptionalContentRegistry;
}

interface EffectiveResourceScope {
  readonly dictionary: PdfDictionary;
  readonly origin: NativePdfResourceOrigin;
  readonly identity: string;
}

interface FormRecord {
  readonly publicForm: NativePdfForm;
  readonly stream: PdfStream;
  readonly semanticIdentity: string;
}

interface PrivateAnnotation {
  readonly publicAnnotation: NativePdfAnnotationAppearance;
  readonly rawValue: PdfValue;
  readonly pageResources: PdfDictionary;
}

interface WidgetFieldChainEntry {
  readonly rawValue: PdfValue;
  readonly dictionary: PdfDictionary;
  readonly identity: string;
}

const IDENTITY_MATRIX: NativePdfMatrix = Object.freeze([1, 0, 0, 1, 0, 0]);
const EMPTY_RESOURCES: PdfDictionary = new Map();
const ANNOTATION_FLAG_INVISIBLE = 1;
const ANNOTATION_FLAG_HIDDEN = 2;
const ANNOTATION_FLAG_NO_VIEW = 32;
const FIELD_FLAG_PUSHBUTTON = 1 << 16;

/** Raw PDF annotation `/F` bits whose compensation depends on the viewer. */
export const NATIVE_PDF_ANNOTATION_VIEW_FLAGS = Object.freeze({
  NoZoom: 8,
  NoRotate: 16
});

/**
 * Lazy, dependency-free registry for Form XObjects and default-view
 * annotation/widget appearances.
 *
 * It deliberately does not synthesize an appearance yet. A visible annotation
 * without a usable /AP /N fails with a typed `unsupported-content` error so it
 * can never disappear silently or trigger a raster fallback.
 */
export class NativePdfFormAppearanceRegistry {
  readonly document: NativePdfDocument;

  private readonly maxFormDepth: number;
  private readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  private readonly optionalContent?: NativeOptionalContentRegistry;
  private readonly diagnostics: PdfDiagnostic[] = [];
  private readonly objectIds = new WeakMap<object, number>();
  private readonly formCache = new Map<string, Promise<FormRecord>>();
  private readonly formRecords = new WeakMap<NativePdfForm, FormRecord>();
  private readonly decodedContentCache = new WeakMap<NativePdfForm, Promise<Uint8Array>>();
  private readonly pageResourceCache = new Map<number, PdfDictionary>();
  private readonly annotationCache = new Map<number, readonly NativePdfAnnotationAppearance[]>();
  private readonly annotationPrivate = new WeakMap<NativePdfAnnotationAppearance, PrivateAnnotation>();
  private readonly inferredStateDiagnostics = new WeakSet<NativePdfAnnotationAppearance>();
  private acroFormCache: NativePdfAcroFormMetadata | null | undefined;
  private nextObjectId = 1;

  constructor(
    document: NativePdfDocument,
    options: NativePdfFormAppearanceRegistryOptions = {}
  ) {
    this.document = document;
    const configuredDepth = options.maxFormDepth ?? document.limits.maxRecursionDepth;
    if (!Number.isSafeInteger(configuredDepth) || configuredDepth <= 0) {
      throw new RangeError("maxFormDepth must be a positive safe integer.");
    }
    this.maxFormDepth = Math.min(configuredDepth, document.limits.maxRecursionDepth);
    this.onDiagnostic = options.onDiagnostic;
    this.optionalContent = options.optionalContent;
  }

  /** Effective invocation-depth ceiling used by graph compilers. */
  get formDepthLimit(): number {
    return this.maxFormDepth;
  }

  getDiagnostics(): readonly PdfDiagnostic[] {
    return Object.freeze(this.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })));
  }

  /** Resolve a page-resource Form named by a `Do` operator. */
  async resolvePageForm(
    pageIndex: number,
    resourceName: string,
    signal?: AbortSignal
  ): Promise<NativePdfFormInvocation> {
    throwIfAborted(signal);
    const resources = await this.getPageResources(pageIndex, signal);
    const record = await this.resolveNamedForm(
      resources,
      resourceName,
      resources,
      `page ${pageIndex}`,
      signal
    );
    return this.createRootInvocation(record);
  }

  /**
   * Resolve a Form name from an arbitrary effective resource scope. This is
   * the same root-invocation contract as a page Form, but is used by reusable
   * content owners such as Type3 CharProcs and tiling-pattern cells.
   */
  async resolveScopedForm(
    resources: PdfDictionary,
    resourceName: string,
    ownerLabel: string,
    signal?: AbortSignal
  ): Promise<NativePdfFormInvocation> {
    throwIfAborted(signal);
    if (!isPdfDictionary(resources)) {
      throw new TypeError("resolveScopedForm requires a resolved resource dictionary.");
    }
    const record = await this.resolveNamedForm(
      resources,
      resourceName,
      resources,
      ownerLabel,
      signal
    );
    return this.createRootInvocation(record);
  }

  /** Resolve a nested Form under an existing invocation with cycle/depth checks. */
  async resolveNestedForm(
    parent: NativePdfFormInvocation,
    resourceName: string,
    signal?: AbortSignal
  ): Promise<NativePdfFormInvocation> {
    throwIfAborted(signal);
    if (parent.depth >= this.maxFormDepth) {
      throw new PdfError(
        "resource-limit",
        `Form XObject invocation exceeds the configured depth limit of ${this.maxFormDepth}.`,
        { details: { reason: "form-depth", maxFormDepth: this.maxFormDepth } }
      );
    }
    const record = await this.resolveNamedForm(
      parent.form.resources,
      resourceName,
      parent.form.resources,
      `Form ${parent.form.id}`,
      signal
    );
    if (parent.ancestry.includes(record.publicForm.id)) {
      throw new PdfError(
        "unsupported-content",
        `Form XObject ${record.publicForm.id} participates in a recursive invocation cycle.`,
        { details: { reason: "form-cycle", formId: record.publicForm.id } }
      );
    }
    return Object.freeze({
      form: record.publicForm,
      depth: parent.depth + 1,
      ancestry: Object.freeze([...parent.ancestry, record.publicForm.id])
    });
  }

  /** Decode and cache a Form's complete filter chain under document limits. */
  async decodeFormContent(form: NativePdfForm, signal?: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal);
    const record = await this.findFormRecord(form);
    const cached = this.decodedContentCache.get(form);
    if (cached) return await cached;
    const pending = this.document.decodeStream(record.stream, signal).catch((error) => {
      this.decodedContentCache.delete(form);
      throw error;
    });
    this.decodedContentCache.set(form, pending);
    return await pending;
  }

  /** Resolve document-level AcroForm defaults used by widget appearances. */
  async getAcroFormMetadata(signal?: AbortSignal): Promise<NativePdfAcroFormMetadata | null> {
    throwIfAborted(signal);
    if (this.acroFormCache !== undefined) return this.acroFormCache;
    const raw = this.document.catalog.get("AcroForm");
    if (raw === undefined || raw === null) {
      this.acroFormCache = null;
      return null;
    }
    const dictionary = await this.document.resolveDictionary(raw, signal);
    const needAppearances = await this.readBoolean(
      dictionary.get("NeedAppearances"),
      false,
      "AcroForm /NeedAppearances",
      signal
    );
    const signatureFlags = await this.readFlagInteger(
      dictionary.get("SigFlags"),
      0,
      "AcroForm /SigFlags",
      signal
    );
    const rawDefaultResources = dictionary.get("DR");
    const defaultResources = rawDefaultResources === undefined || rawDefaultResources === null
      ? undefined
      : await this.document.resolveDictionary(rawDefaultResources, signal);
    const defaultAppearance = await this.readOptionalString(
      dictionary.get("DA"),
      "AcroForm /DA",
      signal
    );
    const quadding = await this.readOptionalQuadding(dictionary.get("Q"), "AcroForm /Q", signal);
    const fieldsValue = await this.document.resolveValue(dictionary.get("Fields"), signal);
    if (!Array.isArray(fieldsValue)) {
      throw new PdfError("invalid-object", "AcroForm /Fields is not an array.");
    }
    if (fieldsValue.length > this.document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "AcroForm root fields exceed the object-cache limit.", {
        details: {
          reason: "acroform-field-count",
          fieldCount: fieldsValue.length,
          maxFields: this.document.limits.maxCachedObjects
        }
      });
    }
    const fields = Object.freeze([...fieldsValue]);
    const metadata: NativePdfAcroFormMetadata = Object.freeze({
      dictionary,
      fields,
      needAppearances,
      signatureFlags,
      defaultResources,
      defaultAppearance,
      quadding,
      fieldCount: fields.length
    });
    this.acroFormCache = metadata;
    return metadata;
  }

  /** Discover page annotations and field metadata without decoding appearances. */
  async listPageAnnotations(
    pageIndex: number,
    signal?: AbortSignal
  ): Promise<readonly NativePdfAnnotationAppearance[]> {
    throwIfAborted(signal);
    const cached = this.annotationCache.get(pageIndex);
    if (cached) return cached;
    const page = this.document.getPage(pageIndex);
    const pageResources = await this.getPageResources(pageIndex, signal);
    const resolved = await this.document.resolveValue(page.annotations, signal);
    if (resolved === undefined || resolved === null) {
      const empty = Object.freeze([]) as readonly NativePdfAnnotationAppearance[];
      this.annotationCache.set(pageIndex, empty);
      return empty;
    }
    if (!Array.isArray(resolved)) {
      throw new PdfError("invalid-object", "A page /Annots entry is not an array.", { pageIndex });
    }
    const maxAnnotations = Math.min(
      this.document.limits.maxCommandsPerPage,
      this.document.limits.maxCachedObjects
    );
    if (resolved.length > maxAnnotations) {
      throw new PdfError("resource-limit", "Page annotations exceed the page command limit.", {
        pageIndex,
        details: {
          reason: "annotation-count",
          annotationCount: resolved.length,
          maxAnnotations
        }
      });
    }
    const annotations: NativePdfAnnotationAppearance[] = [];
    for (let annotationIndex = 0; annotationIndex < resolved.length; annotationIndex += 1) {
      throwIfAborted(signal);
      const rawValue = resolved[annotationIndex];
      const dictionary = await this.document.resolveDictionary(rawValue, signal);
      const type = await this.document.resolveValue(dictionary.get("Type"), signal);
      if (type !== undefined && type !== null && !isPdfName(type, "Annot")) {
        throw new PdfError("invalid-object", "An annotation has an invalid /Type.", {
          pageIndex,
          details: { annotationIndex }
        });
      }
      const subtypeValue = await this.document.resolveValue(dictionary.get("Subtype"), signal);
      if (!isPdfName(subtypeValue)) {
        throw new PdfError("invalid-object", "An annotation has no valid /Subtype.", {
          pageIndex,
          details: { annotationIndex }
        });
      }
      const rectangle = await this.readRectangle(
        dictionary.get("Rect"),
        `annotation ${annotationIndex} /Rect`,
        pageIndex,
        signal
      );
      const flags = await this.readFlagInteger(
        dictionary.get("F"),
        0,
        `annotation ${annotationIndex} /F`,
        signal
      );
      const appearanceStateValue = await this.document.resolveValue(dictionary.get("AS"), signal);
      if (
        appearanceStateValue !== undefined && appearanceStateValue !== null &&
        !isPdfName(appearanceStateValue)
      ) {
        throw new PdfError("invalid-object", "An annotation /AS value is not a name.", {
          pageIndex,
          details: { annotationIndex }
        });
      }
      const widget = subtypeValue.value === "Widget"
        ? await this.readWidgetMetadata(rawValue, pageIndex, annotationIndex, signal)
        : undefined;
      const annotation: NativePdfAnnotationAppearance = Object.freeze({
        id: this.sourceIdentity(rawValue, dictionary),
        pageIndex,
        annotationIndex,
        ref: isPdfRef(rawValue) ? rawValue : null,
        dictionary,
        subtype: subtypeValue.value,
        rectangle,
        flags,
        // /Print controls print output only. Static default View suppresses
        // Invisible, Hidden, and NoView annotations while retaining source order.
        visibleInDefaultView: (
          flags & (ANNOTATION_FLAG_INVISIBLE | ANNOTATION_FLAG_HIDDEN | ANNOTATION_FLAG_NO_VIEW)
        ) === 0,
        appearanceState: appearanceStateValue?.value,
        hasAppearanceDictionary: dictionary.has("AP") && dictionary.get("AP") !== null,
        optionalContent: dictionary.get("OC"),
        widget
      });
      this.annotationPrivate.set(annotation, {
        publicAnnotation: annotation,
        rawValue,
        pageResources
      });
      annotations.push(annotation);
    }
    const result = Object.freeze(annotations);
    this.annotationCache.set(pageIndex, result);
    return result;
  }

  /**
   * Select and validate the normal appearance used in the static default view.
   * Hidden annotations return null; visible unsupported annotations fail.
   */
  async resolveAnnotationAppearance(
    annotation: NativePdfAnnotationAppearance,
    signal?: AbortSignal
  ): Promise<NativePdfResolvedAnnotationAppearance | null> {
    throwIfAborted(signal);
    const privateAnnotation = this.annotationPrivate.get(annotation);
    if (!privateAnnotation) {
      throw new TypeError("The annotation was not created by this registry.");
    }
    if (!annotation.visibleInDefaultView) return null;
    let optionalContentIndex = -1;
    if (annotation.optionalContent !== undefined && annotation.optionalContent !== null) {
      if (!this.optionalContent) {
        throw new PdfError(
          "unsupported-content",
          "Annotation optional-content visibility has not been evaluated.",
          {
            pageIndex: annotation.pageIndex,
            details: {
              annotationIndex: annotation.annotationIndex,
              reason: "annotation-optional-content"
            }
          }
        );
      }
      const membership = await this.optionalContent.resolvePropertyValue(
        annotation.optionalContent,
        signal
      );
      if (!membership) {
        throw new PdfError(
          "invalid-object",
          "Annotation /OC does not resolve to an OCG or OCMD membership.",
          {
            pageIndex: annotation.pageIndex,
            details: {
              annotationIndex: annotation.annotationIndex,
              reason: "annotation-optional-content-invalid"
            }
          }
        );
      }
      if (!membership.defaultVisible) return null;
      optionalContentIndex = membership.index;
    }
    const appearanceValue = annotation.dictionary.get("AP");
    if (appearanceValue === undefined || appearanceValue === null) {
      this.throwMissingAppearance(annotation);
    }
    const appearanceDictionary = await this.document.resolveDictionary(appearanceValue, signal);
    const normalRaw = appearanceDictionary.get("N");
    if (normalRaw === undefined || normalRaw === null) {
      this.throwMissingAppearance(annotation);
    }
    const normal = await this.document.resolveValue(normalRaw, signal);
    let selectedRaw: PdfValue;
    let stateName: string | undefined;
    if (isPdfStream(normal)) {
      selectedRaw = normalRaw;
    } else if (isPdfDictionary(normal)) {
      stateName = this.selectAppearanceState(annotation, normal);
      selectedRaw = normal.get(stateName)!;
      if (selectedRaw === undefined || selectedRaw === null) {
        throw new PdfError(
          "unsupported-content",
          `Annotation appearance state /${stateName} is missing from /AP /N.`,
          {
            pageIndex: annotation.pageIndex,
            details: {
              annotationIndex: annotation.annotationIndex,
              reason: "annotation-appearance-state-missing",
              stateName
            }
          }
        );
      }
    } else {
      throw new PdfError("invalid-object", "Annotation /AP /N is neither a stream nor a state dictionary.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex }
      });
    }
    const inheritedResources = annotation.widget?.acroForm?.defaultResources ??
      privateAnnotation.pageResources;
    const record = await this.loadForm(
      selectedRaw,
      inheritedResources,
      `annotation ${annotation.annotationIndex}`,
      signal
    );
    return Object.freeze({
      annotation,
      normalAppearance: this.createRootInvocation(record),
      stateName,
      optionalContentIndex
    });
  }

  private createRootInvocation(record: FormRecord): NativePdfFormInvocation {
    return Object.freeze({
      form: record.publicForm,
      depth: 1,
      ancestry: Object.freeze([record.publicForm.id])
    });
  }

  private async getPageResources(pageIndex: number, signal?: AbortSignal): Promise<PdfDictionary> {
    const cached = this.pageResourceCache.get(pageIndex);
    if (cached) return cached;
    const page = this.document.getPage(pageIndex);
    const resources = page.resources === undefined || page.resources === null
      ? EMPTY_RESOURCES
      : await this.document.resolveDictionary(page.resources, signal);
    this.pageResourceCache.set(pageIndex, resources);
    return resources;
  }

  private async resolveNamedForm(
    resources: PdfDictionary,
    rawResourceName: string,
    inheritedResources: PdfDictionary,
    ownerLabel: string,
    signal?: AbortSignal
  ): Promise<FormRecord> {
    const resourceName = normalizeResourceName(rawResourceName);
    const xObjectsRaw = resources.get("XObject");
    if (xObjectsRaw === undefined || xObjectsRaw === null) {
      throw new PdfError(
        "unsupported-content",
        `${ownerLabel} invokes /${resourceName}, but its resource scope has no /XObject dictionary.`,
        { details: { reason: "form-resource-missing", resourceName } }
      );
    }
    const xObjects = await this.document.resolveDictionary(xObjectsRaw, signal);
    const rawForm = xObjects.get(resourceName);
    if (rawForm === undefined || rawForm === null) {
      throw new PdfError(
        "unsupported-content",
        `${ownerLabel} invokes missing XObject /${resourceName}.`,
        { details: { reason: "form-resource-missing", resourceName } }
      );
    }
    return await this.loadForm(rawForm, inheritedResources, `/${resourceName}`, signal);
  }

  private async loadForm(
    rawValue: PdfValue,
    inheritedResources: PdfDictionary | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<FormRecord> {
    throwIfAborted(signal);
    const resolved = await this.document.resolveValue(rawValue, signal);
    if (!isPdfStream(resolved)) {
      throw new PdfError("unsupported-content", `${label} is not a Form XObject stream.`, {
        details: { reason: "xobject-not-form", resource: label }
      });
    }
    const dictionary = resolved.dictionary;
    const type = await this.document.resolveValue(dictionary.get("Type"), signal);
    if (type !== undefined && type !== null && !isPdfName(type, "XObject")) {
      throw new PdfError("invalid-object", `${label} has an invalid Form /Type.`);
    }
    const subtype = await this.document.resolveValue(dictionary.get("Subtype"), signal);
    if (!isPdfName(subtype, "Form")) {
      throw new PdfError("unsupported-content", `${label} is not a /Subtype /Form XObject.`, {
        details: {
          reason: "xobject-not-form",
          subtype: isPdfName(subtype) ? subtype.value : null
        }
      });
    }
    const formTypeValue = await this.document.resolveValue(dictionary.get("FormType"), signal);
    if (formTypeValue !== undefined && formTypeValue !== null && formTypeValue !== 1) {
      throw new PdfError("unsupported-content", `${label} has a /FormType other than 1.`, {
        details: { reason: "unsupported-form-type" }
      });
    }
    const resourceScope = await this.resolveFormResources(dictionary, inheritedResources, label, signal);
    const sourceIdentity = this.sourceIdentity(rawValue, resolved);
    const semanticIdentity = `${sourceIdentity}|resources:${resourceScope.identity}`;
    const cached = this.formCache.get(semanticIdentity);
    if (cached) return await cached;
    if (this.formCache.size >= this.document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "Referenced Form definitions exceed the object-cache limit.", {
        details: {
          reason: "form-definition-count",
          maxFormDefinitions: this.document.limits.maxCachedObjects
        }
      });
    }
    const pending = this.parseFormRecord(
      resolved,
      rawValue,
      sourceIdentity,
      semanticIdentity,
      resourceScope,
      label,
      signal
    ).catch((error) => {
      this.formCache.delete(semanticIdentity);
      throw error;
    });
    this.formCache.set(semanticIdentity, pending);
    return await pending;
  }

  private async parseFormRecord(
    stream: PdfStream,
    rawValue: PdfValue,
    sourceIdentity: string,
    semanticIdentity: string,
    resourceScope: EffectiveResourceScope,
    label: string,
    signal?: AbortSignal
  ): Promise<FormRecord> {
    const bbox = await this.readRectangle(dictionaryValue(stream, "BBox"), `${label} /BBox`, undefined, signal);
    const rawMatrix = stream.dictionary.get("Matrix");
    const matrix = rawMatrix === undefined || rawMatrix === null
      ? IDENTITY_MATRIX
      : await this.readMatrix(rawMatrix, `${label} /Matrix`, signal);
    const group = await this.readTransparencyGroup(stream.dictionary.get("Group"), label, signal);
    const publicForm: NativePdfForm = Object.freeze({
      id: sourceIdentity,
      ref: isPdfRef(rawValue) ? rawValue : null,
      dictionary: stream.dictionary,
      bbox,
      matrix,
      resources: resourceScope.dictionary,
      resourceOrigin: resourceScope.origin,
      optionalContent: stream.dictionary.get("OC"),
      group,
      encodedContentBytes: stream.bytes.length
    });
    const record = Object.freeze({ publicForm, stream, semanticIdentity });
    this.formRecords.set(publicForm, record);
    return record;
  }

  private async resolveFormResources(
    dictionary: PdfDictionary,
    inheritedResources: PdfDictionary | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<EffectiveResourceScope> {
    const raw = dictionary.get("Resources");
    if (raw !== undefined && raw !== null) {
      const local = await this.document.resolveDictionary(raw, signal);
      return {
        dictionary: local,
        origin: "local",
        identity: this.valueIdentity(raw, local)
      };
    }
    if (inheritedResources) {
      return {
        dictionary: inheritedResources,
        origin: inheritedResources === EMPTY_RESOURCES ? "empty" : "inherited",
        identity: this.objectIdentity(inheritedResources)
      };
    }
    return { dictionary: EMPTY_RESOURCES, origin: "empty", identity: "empty" };
  }

  private async readTransparencyGroup(
    value: PdfValue | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<NativePdfTransparencyGroup | undefined> {
    if (value === undefined || value === null) return undefined;
    const dictionary = await this.document.resolveDictionary(value, signal);
    const subtype = await this.document.resolveValue(dictionary.get("S"), signal);
    if (!isPdfName(subtype, "Transparency")) {
      throw new PdfError("unsupported-content", `${label} has a non-transparency /Group.`, {
        details: { reason: "unsupported-form-group" }
      });
    }
    const isolated = await this.readBoolean(dictionary.get("I"), false, `${label} /Group /I`, signal);
    const knockout = await this.readBoolean(dictionary.get("K"), false, `${label} /Group /K`, signal);
    const colorSpace = await this.document.resolveValue(dictionary.get("CS"), signal);
    if (
      colorSpace !== undefined && colorSpace !== null &&
      !isPdfName(colorSpace) && !Array.isArray(colorSpace)
    ) {
      throw new PdfError("invalid-object", `${label} /Group /CS is not a color-space name or array.`);
    }
    if (Array.isArray(colorSpace) && colorSpace.length === 0) {
      throw new PdfError("invalid-object", `${label} /Group /CS is an empty color-space array.`);
    }
    return Object.freeze({
      subtype: "Transparency",
      isolated,
      knockout,
      colorSpace: colorSpace ?? undefined
    });
  }

  private async readWidgetMetadata(
    rawWidgetValue: PdfValue,
    pageIndex: number,
    annotationIndex: number,
    signal?: AbortSignal
  ): Promise<NativePdfWidgetMetadata> {
    const acroForm = await this.getAcroFormMetadata(signal);
    const chain: WidgetFieldChainEntry[] = [];
    const names: string[] = [];
    const visited = new Set<string>();
    let raw: PdfValue = rawWidgetValue;
    for (let depth = 0; ; depth += 1) {
      if (depth >= this.document.limits.maxRecursionDepth) {
        throw new PdfError("resource-limit", "Widget field ancestry exceeds the recursion limit.", {
          pageIndex,
          details: { annotationIndex, reason: "field-depth" }
        });
      }
      const dictionary = await this.document.resolveDictionary(raw, signal);
      const identity = this.valueIdentity(raw, dictionary);
      if (visited.has(identity)) {
        throw new PdfError("invalid-object", "Widget field ancestry contains a cycle.", {
          pageIndex,
          details: { annotationIndex, reason: "field-cycle" }
        });
      }
      visited.add(identity);
      chain.push({ rawValue: raw, dictionary, identity });
      const partialName = await this.readOptionalString(dictionary.get("T"), "field /T", signal);
      if (partialName) {
        const decodedName = decodePdfString(partialName, pageIndex, annotationIndex);
        if (decodedName.includes(".")) {
          throw new PdfError("invalid-object", "A partial field /T name contains a period.", {
            pageIndex,
            details: { annotationIndex, reason: "field-partial-name-period" }
          });
        }
        names.push(decodedName);
      }
      const parent = dictionary.get("Parent");
      if (parent === undefined || parent === null) break;
      raw = parent;
    }
    await this.validateWidgetFieldChain(chain, acroForm, pageIndex, annotationIndex, signal);
    const inherited = async (key: string): Promise<PdfValue | undefined> => {
      for (const { dictionary } of chain) {
        if (!dictionary.has(key)) continue;
        const value = await this.document.resolveValue(dictionary.get(key), signal);
        // A null dictionary value is semantically equivalent to an absent
        // entry and therefore cannot stop field inheritance.
        if (value !== undefined && value !== null) return value;
      }
      return undefined;
    };
    const fieldType = await inherited("FT");
    if (fieldType !== undefined && fieldType !== null && !isPdfName(fieldType)) {
      throw new PdfError("invalid-object", "Widget field /FT is not a name.", { pageIndex });
    }
    const flagsValue = await inherited("Ff");
    const fieldFlags = flagsValue === undefined || flagsValue === null
      ? 0
      : requireFlagInteger(flagsValue, "Widget field /Ff");
    const defaultAppearanceValue = await inherited("DA");
    if (
      defaultAppearanceValue !== undefined && defaultAppearanceValue !== null &&
      !isPdfString(defaultAppearanceValue)
    ) {
      throw new PdfError("invalid-object", "Widget field /DA is not a string.", { pageIndex });
    }
    const quaddingValue = await inherited("Q");
    const quadding = quaddingValue === undefined || quaddingValue === null
      ? undefined
      : requireQuadding(quaddingValue, "Widget field /Q");
    const maxLengthValue = await inherited("MaxLen");
    let maxLength: number | undefined;
    if (maxLengthValue !== undefined && maxLengthValue !== null) {
      if (typeof maxLengthValue !== "number" || !Number.isSafeInteger(maxLengthValue) || maxLengthValue <= 0) {
        throw new PdfError("invalid-object", "Widget field /MaxLen is not a positive integer.", {
          pageIndex,
          details: { annotationIndex, reason: "field-max-length" }
        });
      }
      maxLength = maxLengthValue;
    }
    const value = await inherited("V");
    const defaultValue = await inherited("DV");
    await this.validateFieldValue(fieldType?.value, value, "V", pageIndex, annotationIndex, signal);
    await this.validateFieldValue(
      fieldType?.value,
      defaultValue,
      "DV",
      pageIndex,
      annotationIndex,
      signal
    );
    const choiceOptions = fieldType?.value === "Ch"
      ? await this.readChoiceOptions(await inherited("Opt"), pageIndex, annotationIndex, signal)
      : undefined;
    const selectedChoiceIndices = fieldType?.value === "Ch"
      ? await this.readChoiceIndices(
        await inherited("I"),
        choiceOptions?.length,
        pageIndex,
        annotationIndex,
        signal
      )
      : undefined;
    const topChoiceIndex = fieldType?.value === "Ch"
      ? await this.readChoiceTopIndex(
        await inherited("TI"),
        choiceOptions?.length,
        pageIndex,
        annotationIndex
      )
      : undefined;
    const partialNames = Object.freeze([...names].reverse());
    const fullyQualifiedName = partialNames.length > 0 ? partialNames.join(".") : undefined;
    return Object.freeze({
      fieldType: fieldType?.value,
      partialNames,
      fullyQualifiedName,
      value,
      defaultValue,
      fieldFlags,
      defaultAppearance: defaultAppearanceValue ?? acroForm?.defaultAppearance,
      quadding: quadding ?? acroForm?.quadding,
      maxLength,
      choiceOptions,
      selectedChoiceIndices,
      topChoiceIndex,
      acroForm
    });
  }

  private async readChoiceOptions(
    value: PdfValue | undefined,
    pageIndex: number,
    annotationIndex: number,
    signal?: AbortSignal
  ): Promise<readonly NativePdfChoiceOption[] | undefined> {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) {
      throw fieldStructureError(
        "A choice field /Opt value is not an array.",
        pageIndex,
        annotationIndex,
        "choice-options-type"
      );
    }
    if (value.length > this.document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "A choice field has too many /Opt entries.", {
        pageIndex,
        details: {
          annotationIndex,
          reason: "choice-option-count",
          optionCount: value.length,
          maxOptions: this.document.limits.maxCachedObjects
        }
      });
    }
    const options: NativePdfChoiceOption[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if ((index & 0x3ff) === 0) throwIfAborted(signal);
      const resolved = await this.document.resolveValue(value[index], signal);
      let exportValue: PdfString;
      let displayValue: PdfString;
      if (isPdfString(resolved)) {
        exportValue = resolved;
        displayValue = resolved;
      } else if (Array.isArray(resolved) && resolved.length === 2) {
        const first = await this.document.resolveValue(resolved[0], signal);
        const second = await this.document.resolveValue(resolved[1], signal);
        if (!isPdfString(first) || !isPdfString(second)) {
          throw fieldStructureError(
            "A choice field /Opt pair does not contain two strings.",
            pageIndex,
            annotationIndex,
            "choice-option-pair"
          );
        }
        exportValue = first;
        displayValue = second;
      } else {
        throw fieldStructureError(
          "A choice field /Opt entry is neither a string nor a two-string array.",
          pageIndex,
          annotationIndex,
          "choice-option-entry"
        );
      }
      options.push(Object.freeze({ exportValue, displayValue }));
    }
    return Object.freeze(options);
  }

  private async readChoiceIndices(
    value: PdfValue | undefined,
    optionCount: number | undefined,
    pageIndex: number,
    annotationIndex: number,
    signal?: AbortSignal
  ): Promise<readonly number[] | undefined> {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) {
      throw fieldStructureError(
        "A choice field /I value is not an array.",
        pageIndex,
        annotationIndex,
        "choice-indices-type"
      );
    }
    if (value.length > this.document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "A choice field has too many /I entries.", {
        pageIndex,
        details: {
          annotationIndex,
          reason: "choice-index-count",
          indexCount: value.length,
          maxIndices: this.document.limits.maxCachedObjects
        }
      });
    }
    const indices: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if ((index & 0x3ff) === 0) throwIfAborted(signal);
      const resolved = await this.document.resolveValue(value[index], signal);
      if (
        typeof resolved !== "number" || !Number.isSafeInteger(resolved) || resolved < 0 ||
        (optionCount !== undefined && resolved >= optionCount) ||
        (indices.length > 0 && resolved <= indices[indices.length - 1])
      ) {
        throw fieldStructureError(
          "A choice field /I array is not strictly increasing within /Opt.",
          pageIndex,
          annotationIndex,
          "choice-index-value"
        );
      }
      indices.push(resolved);
    }
    return Object.freeze(indices);
  }

  private async readChoiceTopIndex(
    value: PdfValue | undefined,
    optionCount: number | undefined,
    pageIndex: number,
    annotationIndex: number
  ): Promise<number | undefined> {
    if (value === undefined || value === null) return undefined;
    if (
      typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
      (optionCount !== undefined && (optionCount === 0 ? value !== 0 : value >= optionCount))
    ) {
      throw fieldStructureError(
        "A choice field /TI value is outside /Opt.",
        pageIndex,
        annotationIndex,
        "choice-top-index"
      );
    }
    return value;
  }

  private async validateFieldValue(
    fieldType: string | undefined,
    value: PdfValue | undefined,
    key: "V" | "DV",
    pageIndex: number,
    annotationIndex: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (value === undefined || value === null || fieldType === undefined) return;
    let valid = true;
    if (fieldType === "Btn") {
      valid = isPdfName(value);
    } else if (fieldType === "Tx") {
      valid = isPdfString(value);
    } else if (fieldType === "Ch") {
      if (isPdfString(value)) return;
      if (!Array.isArray(value)) valid = false;
      else {
        if (value.length > this.document.limits.maxCachedObjects) {
          throw new PdfError("resource-limit", `Widget field /${key} has too many choice values.`, {
            pageIndex,
            details: {
              annotationIndex,
              reason: "field-value-count",
              valueCount: value.length,
              maxValues: this.document.limits.maxCachedObjects
            }
          });
        }
        for (let index = 0; index < value.length; index += 1) {
          if ((index & 0x3ff) === 0) throwIfAborted(signal);
          if (!isPdfString(await this.document.resolveValue(value[index], signal))) {
            valid = false;
            break;
          }
        }
      }
    } else if (fieldType === "Sig") {
      valid = isPdfDictionary(value);
    }
    if (!valid) {
      throw new PdfError("invalid-object", `Widget field /${key} is invalid for /FT /${fieldType}.`, {
        pageIndex,
        details: { annotationIndex, reason: "field-value-type", fieldType, key }
      });
    }
  }

  private async validateWidgetFieldChain(
    chain: readonly WidgetFieldChainEntry[],
    acroForm: NativePdfAcroFormMetadata | null,
    pageIndex: number,
    annotationIndex: number,
    signal?: AbortSignal
  ): Promise<void> {
    for (let childIndex = 0; childIndex + 1 < chain.length; childIndex += 1) {
      throwIfAborted(signal);
      const child = chain[childIndex];
      const parent = chain[childIndex + 1];
      const kids = await this.document.resolveValue(parent.dictionary.get("Kids"), signal);
      if (!Array.isArray(kids)) {
        throw fieldStructureError(
          "A Widget field parent has no valid /Kids array.",
          pageIndex,
          annotationIndex,
          "field-parent-kids"
        );
      }
      if (kids.length > this.document.limits.maxCachedObjects) {
        throw new PdfError("resource-limit", "A field /Kids array exceeds the object-cache limit.", {
          pageIndex,
          details: {
            annotationIndex,
            reason: "field-kids-count",
            kidCount: kids.length,
            maxKids: this.document.limits.maxCachedObjects
          }
        });
      }
      const seenKids = new Set<string>();
      let childOccurrences = 0;
      const ancestorIdentities = new Set(chain.slice(childIndex + 1).map((entry) => entry.identity));
      for (let kidIndex = 0; kidIndex < kids.length; kidIndex += 1) {
        if ((kidIndex & 0x3ff) === 0) throwIfAborted(signal);
        const kid = kids[kidIndex];
        const identity = this.directFieldIdentity(kid);
        if (identity === null) {
          throw fieldStructureError(
            "A field /Kids array contains a non-field value.",
            pageIndex,
            annotationIndex,
            "field-kid-invalid"
          );
        }
        if (seenKids.has(identity)) {
          throw fieldStructureError(
            "A field /Kids array contains a duplicate field.",
            pageIndex,
            annotationIndex,
            "field-kid-duplicate"
          );
        }
        seenKids.add(identity);
        if (identity === child.identity) childOccurrences += 1;
        if (ancestorIdentities.has(identity)) {
          throw fieldStructureError(
            "A field /Kids array links back to itself or an ancestor.",
            pageIndex,
            annotationIndex,
            "field-kids-cycle"
          );
        }
      }
      if (childOccurrences !== 1) {
        throw fieldStructureError(
          "A Widget /Parent does not contain the child exactly once in /Kids.",
          pageIndex,
          annotationIndex,
          "field-parent-child-mismatch"
        );
      }
    }
    if (acroForm && chain.length > 0) {
      const rootIdentity = chain[chain.length - 1].identity;
      let rootOccurrences = 0;
      for (let fieldIndex = 0; fieldIndex < acroForm.fields.length; fieldIndex += 1) {
        if ((fieldIndex & 0x3ff) === 0) throwIfAborted(signal);
        const root = acroForm.fields[fieldIndex];
        const identity = this.directFieldIdentity(root);
        if (identity === rootIdentity) rootOccurrences += 1;
      }
      if (rootOccurrences !== 1) {
        throw fieldStructureError(
          "A Widget field root is not present exactly once in AcroForm /Fields.",
          pageIndex,
          annotationIndex,
          rootOccurrences === 0 ? "field-root-missing" : "field-root-duplicate"
        );
      }
    }
  }

  private directFieldIdentity(value: PdfValue): string | null {
    if (isPdfRef(value)) return `ref:${pdfRefKey(value)}`;
    if (isPdfDictionary(value)) return this.objectIdentity(value);
    return null;
  }

  private selectAppearanceState(
    annotation: NativePdfAnnotationAppearance,
    states: PdfDictionary
  ): string {
    if (annotation.appearanceState !== undefined) return annotation.appearanceState;
    const widgetState = annotation.widget?.value;
    if (isPdfName(widgetState) && states.has(widgetState.value)) return widgetState.value;
    // Button values are field-wide. A radio widget whose on-state does not
    // equal the inherited /V is the unselected sibling and therefore uses Off.
    if (
      annotation.widget?.fieldType === "Btn" &&
      (annotation.widget.fieldFlags & FIELD_FLAG_PUSHBUTTON) === 0 &&
      states.has("Off")
    ) return "Off";
    if (states.size === 1) {
      const inferred = states.keys().next().value as string;
      if (!this.inferredStateDiagnostics.has(annotation)) {
        this.inferredStateDiagnostics.add(annotation);
        this.emitDiagnostic({
          code: "annotation.appearance-state-inferred",
          severity: "warning",
          message: `Annotation ${annotation.annotationIndex} has no /AS; its sole normal appearance /${inferred} was selected.`,
          pageIndex: annotation.pageIndex,
          details: { annotationIndex: annotation.annotationIndex, stateName: inferred }
        });
      }
      return inferred;
    }
    throw new PdfError(
      "unsupported-content",
      "Annotation /AP /N is a state dictionary, but no unambiguous appearance state is available.",
      {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          reason: "annotation-appearance-state-ambiguous"
        }
      }
    );
  }

  private throwMissingAppearance(annotation: NativePdfAnnotationAppearance): never {
    throw new PdfError(
      "unsupported-content",
      `Visible /${annotation.subtype} annotation ${annotation.annotationIndex} has no usable normal appearance; native synthesis is not implemented.`,
      {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          reason: "appearance-synthesis-not-implemented",
          subtype: annotation.subtype
        }
      }
    );
  }

  private async findFormRecord(form: NativePdfForm): Promise<FormRecord> {
    const record = this.formRecords.get(form);
    if (record) return record;
    throw new TypeError("The Form was not created by this registry.");
  }

  private async readRectangle(
    value: PdfValue | undefined,
    label: string,
    pageIndex: number | undefined,
    signal?: AbortSignal
  ): Promise<NativePdfRectangle> {
    const values = await this.readNumberArray(value, 4, label, signal);
    return Object.freeze([
      Math.min(values[0], values[2]),
      Math.min(values[1], values[3]),
      Math.max(values[0], values[2]),
      Math.max(values[1], values[3])
    ]) as NativePdfRectangle;
  }

  private async readMatrix(
    value: PdfValue | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<NativePdfMatrix> {
    const values = await this.readNumberArray(value, 6, label, signal);
    return Object.freeze(values) as NativePdfMatrix;
  }

  private async readNumberArray(
    value: PdfValue | undefined,
    length: number,
    label: string,
    signal?: AbortSignal
  ): Promise<number[]> {
    const resolved = await this.document.resolveValue(value, signal);
    if (!Array.isArray(resolved) || resolved.length !== length) {
      throw new PdfError("invalid-object", `${label} is not a ${length}-number array.`);
    }
    const numbers: number[] = [];
    for (const raw of resolved) {
      const entry = await this.document.resolveValue(raw, signal);
      if (typeof entry !== "number" || !Number.isFinite(entry)) {
        throw new PdfError("invalid-object", `${label} contains a non-finite number.`);
      }
      numbers.push(entry);
    }
    return numbers;
  }

  private async readBoolean(
    value: PdfValue | undefined,
    fallback: boolean,
    label: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    const resolved = await this.document.resolveValue(value, signal);
    if (resolved === undefined || resolved === null) return fallback;
    if (typeof resolved !== "boolean") {
      throw new PdfError("invalid-object", `${label} is not a boolean.`);
    }
    return resolved;
  }

  private async readFlagInteger(
    value: PdfValue | undefined,
    fallback: number,
    label: string,
    signal?: AbortSignal
  ): Promise<number> {
    const resolved = await this.document.resolveValue(value, signal);
    if (resolved === undefined || resolved === null) return fallback;
    return requireFlagInteger(resolved, label);
  }

  private async readOptionalQuadding(
    value: PdfValue | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<0 | 1 | 2 | undefined> {
    const resolved = await this.document.resolveValue(value, signal);
    if (resolved === undefined || resolved === null) return undefined;
    return requireQuadding(resolved, label);
  }

  private async readOptionalString(
    value: PdfValue | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<PdfString | undefined> {
    const resolved = await this.document.resolveValue(value, signal);
    if (resolved === undefined || resolved === null) return undefined;
    if (!isPdfString(resolved)) throw new PdfError("invalid-object", `${label} is not a string.`);
    return resolved;
  }

  private sourceIdentity(rawValue: PdfValue, resolved: object): string {
    return isPdfRef(rawValue) ? `ref:${pdfRefKey(rawValue)}` : `direct:${this.objectIdentity(resolved)}`;
  }

  private valueIdentity(rawValue: PdfValue, resolved: object): string {
    return isPdfRef(rawValue) ? `ref:${pdfRefKey(rawValue)}` : this.objectIdentity(resolved);
  }

  private objectIdentity(value: object): string {
    let id = this.objectIds.get(value);
    if (id === undefined) {
      id = this.nextObjectId++;
      this.objectIds.set(value, id);
    }
    return `object:${id}`;
  }

  private emitDiagnostic(diagnostic: PdfDiagnostic): void {
    const frozen = Object.freeze({ ...diagnostic });
    this.diagnostics.push(frozen);
    this.onDiagnostic?.(frozen);
  }
}

function normalizeResourceName(value: string): string {
  const normalized = value.startsWith("/") ? value.slice(1) : value;
  if (normalized.length === 0) throw new TypeError("A PDF resource name cannot be empty.");
  return normalized;
}

function dictionaryValue(stream: PdfStream, key: string): PdfValue | undefined {
  const value = stream.dictionary.get(key);
  if (value === undefined || value === null) {
    throw new PdfError("invalid-object", `Form XObject has no /${key}.`);
  }
  return value;
}

function requireFlagInteger(value: PdfValue, label: string): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < 0 || value > 0xffff_ffff
  ) {
    throw new PdfError("invalid-object", `${label} is not a 32-bit non-negative integer.`);
  }
  return value;
}

function requireQuadding(value: PdfValue, label: string): 0 | 1 | 2 {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new PdfError("invalid-object", `${label} is not 0, 1, or 2.`);
  }
  return value;
}

function fieldStructureError(
  message: string,
  pageIndex: number,
  annotationIndex: number,
  reason: string
): PdfError {
  return new PdfError("invalid-object", message, {
    pageIndex,
    details: { annotationIndex, reason }
  });
}

function decodePdfString(
  value: PdfString,
  pageIndex: number,
  annotationIndex: number
): string {
  const bytes = value.bytes;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeFieldUtf16(bytes.subarray(2), false, pageIndex, annotationIndex);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeFieldUtf16(bytes.subarray(2), true, pageIndex, annotationIndex);
  }
  if (
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  ) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3));
    } catch (cause) {
      throw fieldNameEncodingError("A field /T name has malformed UTF-8 bytes.", pageIndex, annotationIndex, cause);
    }
  }
  let result = "";
  for (const byte of bytes) result += PDF_DOC_ENCODING[byte] ?? String.fromCharCode(byte);
  return result;
}

function decodeFieldUtf16(
  bytes: Uint8Array,
  littleEndian: boolean,
  pageIndex: number,
  annotationIndex: number
): string {
  if (bytes.length % 2 !== 0) {
    throw fieldNameEncodingError(
      "A field /T name has malformed UTF-16 bytes.",
      pageIndex,
      annotationIndex
    );
  }
  let result = "";
  for (let index = 0; index < bytes.length; index += 2) {
    const code = littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1];
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 3 >= bytes.length) {
        throw fieldNameEncodingError(
          "A field /T name has an unpaired UTF-16 high surrogate.",
          pageIndex,
          annotationIndex
        );
      }
      const low = littleEndian
        ? bytes[index + 2] | (bytes[index + 3] << 8)
        : (bytes[index + 2] << 8) | bytes[index + 3];
      if (low < 0xdc00 || low > 0xdfff) {
        throw fieldNameEncodingError(
          "A field /T name has an unpaired UTF-16 high surrogate.",
          pageIndex,
          annotationIndex
        );
      }
      result += String.fromCharCode(code, low);
      index += 2;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw fieldNameEncodingError(
        "A field /T name has an unpaired UTF-16 low surrogate.",
        pageIndex,
        annotationIndex
      );
    }
    result += String.fromCharCode(code);
  }
  return result;
}

function fieldNameEncodingError(
  message: string,
  pageIndex: number,
  annotationIndex: number,
  cause?: unknown
): PdfError {
  return new PdfError("invalid-object", message, {
    pageIndex,
    cause,
    details: { annotationIndex, reason: "field-name-encoding" }
  });
}

const PDF_DOC_ENCODING: Readonly<Record<number, string>> = Object.freeze({
  0x18: "\u02d8", 0x19: "\u02c7", 0x1a: "\u02c6", 0x1b: "\u02d9",
  0x1c: "\u02dd", 0x1d: "\u02db", 0x1e: "\u02da", 0x1f: "\u02dc",
  0x80: "\u2022", 0x81: "\u2020", 0x82: "\u2021", 0x83: "\u2026",
  0x84: "\u2014", 0x85: "\u2013", 0x86: "\u0192", 0x87: "\u2044",
  0x88: "\u2039", 0x89: "\u203a", 0x8a: "\u2212", 0x8b: "\u2030",
  0x8c: "\u201e", 0x8d: "\u201c", 0x8e: "\u201d", 0x8f: "\u2018",
  0x90: "\u2019", 0x91: "\u201a", 0x92: "\u2122", 0x93: "\ufb01",
  0x94: "\ufb02", 0x95: "\u0141", 0x96: "\u0152", 0x97: "\u0160",
  0x98: "\u0178", 0x99: "\u017d", 0x9a: "\u0131", 0x9b: "\u0142",
  0x9c: "\u0153", 0x9d: "\u0161", 0x9e: "\u017e", 0xa0: "\u20ac"
});
