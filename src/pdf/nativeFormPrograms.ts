import {
  scanDensePdfResourceReferences,
  type DensePdfMatrix,
  type DensePdfResourceReferences
} from "./nativeContentCompiler";
import { scanPreparedResourceReferencesFastOrExact } from "./nativeFastResourceScanner";
import {
  DEFAULT_NATIVE_INLINE_IMAGE_LIMITS,
  prepareNativeInlineImages,
  type NativeInlineImageResult
} from "./nativeInlineImage";
import {
  isPdfName,
  isPdfStream,
  type PdfDictionary
} from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import type { NativeOptionalContentRegistry } from "./nativeOptionalContent";
import {
  computeNativePdfAnnotationPlacement,
  type NativePdfAnnotationPlacement
} from "./nativeFormGeometry";
import {
  NativePdfFormAppearanceRegistry,
  type NativePdfAnnotationAppearance,
  type NativePdfForm,
  type NativePdfFormInvocation,
  type NativePdfResolvedAnnotationAppearance
} from "./nativeForms";
import {
  NativePdfAppearanceSynthesizer,
  resolveNativePdfAnnotationAppearanceWithSynthesis
} from "./nativeAppearanceSynthesis";
import { PdfError, throwIfAborted } from "./nativeTypes";

export interface NativePdfFormDefinition {
  readonly definitionIndex: number;
  readonly form: NativePdfForm;
  /** First source resource name used for diagnostics and HEP metadata. */
  readonly resourceName: string;
  readonly content: Uint8Array;
  /** Prepared once; scanners/compilers consume only its non-image spans. */
  readonly preparedContent: NativeInlineImageResult;
  /** Referenced local name to page-local Form definition index. */
  readonly formResources: ReadonlyMap<string, number>;
  /** Referenced local Image names, in exact first-use order. */
  readonly imageResourceNames: readonly string[];
  readonly resources: PdfDictionary;
  /** Exact first-use resource manifest for the decoded Form content. */
  readonly resourceReferences: DensePdfResourceReferences;
  /** Static association from the Form XObject dictionary itself. */
  readonly optionalContentIndex: number;
  readonly defaultVisible: boolean;
}

export interface NativePdfAnnotationProgramPlacement extends NativePdfAnnotationPlacement {
  readonly annotation: NativePdfAnnotationAppearance;
  readonly appearance: NativePdfResolvedAnnotationAppearance;
  readonly definitionIndex: number;
  readonly resourceName: string;
}

export interface NativePdfFormDefinitionGraph {
  /** Page resource name to page-local Form definition index. */
  readonly pageForms: ReadonlyMap<string, number>;
  readonly definitions: readonly NativePdfFormDefinition[];
  /** Visible normal appearances in page /Annots array order. */
  readonly annotationPlacements: readonly NativePdfAnnotationProgramPlacement[];
}

export interface NativePdfFormGraphOptions {
  /** Page-local image names already owned by the native image registry. */
  readonly pageImageNames?: ReadonlySet<string>;
  /** Reuse the caller's exact first-use XObject classification. */
  readonly pageXObjectReferences?: readonly NativePdfXObjectReference[];
  readonly optionalContent?: NativeOptionalContentRegistry;
  /** Deterministic fallback for visible Widgets without a usable `/AP /N`. */
  readonly appearanceSynthesizer?: NativePdfAppearanceSynthesizer;
  /** Reuse the caller's exact page scan instead of lexing page content again. */
  readonly pageResourceReferences?: DensePdfResourceReferences;
  readonly signal?: AbortSignal;
}

export interface NativePdfScopedFormGraphOptions {
  readonly pageIndex: number;
  readonly resourceName: string;
  readonly optionalContent?: NativeOptionalContentRegistry;
  readonly signal?: AbortSignal;
}

export interface NativePdfResourceFormGraphOptions {
  readonly pageIndex: number;
  readonly ownerLabel: string;
  readonly optionalContent?: NativeOptionalContentRegistry;
  readonly signal?: AbortSignal;
}

interface MutableDefinition {
  readonly definitionIndex: number;
  readonly invocation: NativePdfFormInvocation;
  readonly resourceName: string;
  content?: Uint8Array;
  preparedContent?: NativeInlineImageResult;
  formResources?: ReadonlyMap<string, number>;
  imageResourceNames?: readonly string[];
  resourceReferences?: DensePdfResourceReferences;
  optionalContentIndex?: number;
  defaultVisible?: boolean;
}

/**
 * Resolve only Forms reached by source `Do` operators and visible default-view
 * annotation appearances. Unused malformed XObjects remain lazy.
 *
 * Image names are classified but stay lazy; the session binds them through its
 * shared image/color registry only when the corresponding program is compiled.
 */
export async function buildNativePdfFormDefinitionGraph(
  document: NativePdfDocument,
  registry: NativePdfFormAppearanceRegistry,
  pageIndex: number,
  pageContent: readonly Uint8Array[],
  pageMatrix: DensePdfMatrix,
  options: NativePdfFormGraphOptions = {}
): Promise<NativePdfFormDefinitionGraph> {
  throwIfAborted(options.signal);
  const byForm = new WeakMap<NativePdfForm, MutableDefinition>();
  const mutable: MutableDefinition[] = [];

  const prepare = async (
    invocation: NativePdfFormInvocation,
    resourceName: string
  ): Promise<number> => {
    throwIfAborted(options.signal);
    const existing = byForm.get(invocation.form);
    if (existing) return existing.definitionIndex;
    if (mutable.length >= document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "Referenced Form definitions exceed the object-cache limit.", {
        pageIndex,
        details: {
          reason: "form-definition-count",
          maxFormDefinitions: document.limits.maxCachedObjects
        }
      });
    }
    const definition: MutableDefinition = {
      definitionIndex: mutable.length,
      invocation,
      resourceName
    };
    mutable.push(definition);
    byForm.set(invocation.form, definition);
    const association = await resolveFormOptionalContent(
      invocation.form,
      options.optionalContent,
      options.signal
    );
    definition.optionalContentIndex = association.optionalContentIndex;
    definition.defaultVisible = association.defaultVisible;
    if (!association.defaultVisible) {
      definition.content = new Uint8Array(0);
      definition.preparedContent = prepareFormInlineContent(
        document,
        definition.content,
        options.signal
      );
      definition.formResources = new Map();
      definition.imageResourceNames = Object.freeze([]);
      definition.resourceReferences = scanPreparedResourceReferencesFastOrExact(
        definition.preparedContent.segments,
        { signal: options.signal }
      ).references;
      return definition.definitionIndex;
    }
    const content = options.appearanceSynthesizer?.getDecodedFormContent(invocation.form) ??
      await registry.decodeFormContent(invocation.form, options.signal);
    const preparedContent = prepareFormInlineContent(document, content, options.signal);
    const resourceReferences = scanPreparedResourceReferencesFastOrExact(
      preparedContent.segments,
      { signal: options.signal }
    ).references;
    const formResources = new Map<string, number>();
    const imageResourceNames: string[] = [];
    const xObjects = await classifyNativePdfXObjectReferences(
      document,
      invocation.form.resources,
      resourceReferences.xObjects,
      options.signal
    );
    for (const xObject of xObjects) {
      if (xObject.kind === "Image") {
        imageResourceNames.push(xObject.resourceName);
        continue;
      }
      const nested = await registry.resolveNestedForm(
        invocation,
        xObject.resourceName,
        options.signal
      );
      formResources.set(
        xObject.resourceName,
        await prepare(nested, xObject.resourceName)
      );
    }
    definition.content = content;
    definition.preparedContent = preparedContent;
    definition.formResources = formResources;
    definition.imageResourceNames = Object.freeze(imageResourceNames);
    definition.resourceReferences = resourceReferences;
    return definition.definitionIndex;
  };

  const pageForms = new Map<string, number>();
  const pageReferences = options.pageResourceReferences ??
    scanDensePdfResourceReferences(joinContent(pageContent));
  if (options.pageXObjectReferences) {
    for (const xObject of options.pageXObjectReferences) {
      throwIfAborted(options.signal);
      if (xObject.kind === "Image") continue;
      const invocation = await registry.resolvePageForm(
        pageIndex,
        xObject.resourceName,
        options.signal
      );
      pageForms.set(
        xObject.resourceName,
        await prepare(invocation, xObject.resourceName)
      );
    }
  } else {
    for (const resourceName of pageReferences.xObjects) {
      throwIfAborted(options.signal);
      if (options.pageImageNames?.has(resourceName)) continue;
      const invocation = await registry.resolvePageForm(pageIndex, resourceName, options.signal);
      pageForms.set(resourceName, await prepare(invocation, resourceName));
    }
  }

  const annotationPlacements: NativePdfAnnotationProgramPlacement[] = [];
  const annotations = await registry.listPageAnnotations(pageIndex, options.signal);
  for (const annotation of annotations) {
    throwIfAborted(options.signal);
    const appearance = options.appearanceSynthesizer
      ? await resolveNativePdfAnnotationAppearanceWithSynthesis(
          registry,
          options.appearanceSynthesizer,
          annotation,
          options.signal
        )
      : await registry.resolveAnnotationAppearance(annotation, options.signal);
    if (!appearance) continue;
    const resourceName = `${annotation.subtype}#${annotation.annotationIndex}`;
    const definitionIndex = await prepare(appearance.normalAppearance, resourceName);
    annotationPlacements.push(Object.freeze({
      annotation,
      appearance,
      definitionIndex,
      resourceName,
      ...computeNativePdfAnnotationPlacement(annotation, appearance.normalAppearance.form, pageMatrix)
    }));
  }

  const definitions = mutable.map((definition): NativePdfFormDefinition => {
    if (
      !definition.content || !definition.preparedContent ||
      !definition.formResources || !definition.imageResourceNames ||
      !definition.resourceReferences ||
      definition.optionalContentIndex === undefined ||
      definition.defaultVisible === undefined
    ) {
      throw new PdfError("invalid-object", "A referenced Form definition was not completely resolved.", {
        pageIndex,
        details: { reason: "form-definition-incomplete" }
      });
    }
    return Object.freeze({
      definitionIndex: definition.definitionIndex,
      form: definition.invocation.form,
      resourceName: definition.resourceName,
      content: definition.content,
      preparedContent: definition.preparedContent,
      formResources: definition.formResources,
      imageResourceNames: definition.imageResourceNames,
      resources: definition.invocation.form.resources,
      resourceReferences: definition.resourceReferences,
      optionalContentIndex: definition.optionalContentIndex,
      defaultVisible: definition.defaultVisible
    });
  });
  validateAcyclicDefinitions(definitions, pageIndex);
  validateDefinitionDepth(
    definitions,
    [
      ...pageForms.values(),
      ...annotationPlacements.map((placement) => placement.definitionIndex)
    ],
    registry.formDepthLimit,
    pageIndex
  );
  return Object.freeze({
    pageForms,
    definitions: Object.freeze(definitions),
    annotationPlacements: Object.freeze(annotationPlacements)
  });
}

/**
 * Build the same lazy, cycle-checked definition graph for a Form supplied by
 * another native registry (notably an ExtGState soft-mask `/G` Form). The
 * caller supplies the already decoded root bytes; nested Forms continue to be
 * resolved and decoded by the shared Form registry.
 */
export async function buildNativePdfScopedFormDefinitionGraph(
  document: NativePdfDocument,
  registry: NativePdfFormAppearanceRegistry,
  rootForm: NativePdfForm,
  rootContent: Uint8Array,
  options: NativePdfScopedFormGraphOptions
): Promise<NativePdfFormDefinitionGraph> {
  throwIfAborted(options.signal);
  const byForm = new WeakMap<NativePdfForm, MutableDefinition>();
  const mutable: MutableDefinition[] = [];
  const rootInvocation: NativePdfFormInvocation = Object.freeze({
    form: rootForm,
    depth: 1,
    ancestry: Object.freeze([rootForm.id])
  });

  const prepare = async (
    invocation: NativePdfFormInvocation,
    resourceName: string,
    suppliedContent?: Uint8Array
  ): Promise<number> => {
    throwIfAborted(options.signal);
    const existing = byForm.get(invocation.form);
    if (existing) return existing.definitionIndex;
    if (mutable.length >= document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "Referenced Form definitions exceed the object-cache limit.", {
        pageIndex: options.pageIndex,
        details: {
          reason: "form-definition-count",
          maxFormDefinitions: document.limits.maxCachedObjects
        }
      });
    }
    const definition: MutableDefinition = {
      definitionIndex: mutable.length,
      invocation,
      resourceName
    };
    mutable.push(definition);
    byForm.set(invocation.form, definition);
    const association = await resolveFormOptionalContent(
      invocation.form,
      options.optionalContent,
      options.signal
    );
    definition.optionalContentIndex = association.optionalContentIndex;
    definition.defaultVisible = association.defaultVisible;
    if (!association.defaultVisible) {
      definition.content = new Uint8Array(0);
      definition.preparedContent = prepareFormInlineContent(
        document,
        definition.content,
        options.signal
      );
      definition.formResources = new Map();
      definition.imageResourceNames = Object.freeze([]);
      definition.resourceReferences = scanPreparedResourceReferencesFastOrExact(
        definition.preparedContent.segments,
        { signal: options.signal }
      ).references;
      return definition.definitionIndex;
    }
    const content = suppliedContent ?? await registry.decodeFormContent(
      invocation.form,
      options.signal
    );
    const preparedContent = prepareFormInlineContent(document, content, options.signal);
    const resourceReferences = scanPreparedResourceReferencesFastOrExact(
      preparedContent.segments,
      { signal: options.signal }
    ).references;
    const formResources = new Map<string, number>();
    const imageResourceNames: string[] = [];
    const xObjects = await classifyNativePdfXObjectReferences(
      document,
      invocation.form.resources,
      resourceReferences.xObjects,
      options.signal
    );
    for (const xObject of xObjects) {
      if (xObject.kind === "Image") {
        imageResourceNames.push(xObject.resourceName);
        continue;
      }
      const nested = await registry.resolveNestedForm(
        invocation,
        xObject.resourceName,
        options.signal
      );
      formResources.set(
        xObject.resourceName,
        await prepare(nested, xObject.resourceName)
      );
    }
    definition.content = content;
    definition.preparedContent = preparedContent;
    definition.formResources = formResources;
    definition.imageResourceNames = Object.freeze(imageResourceNames);
    definition.resourceReferences = resourceReferences;
    return definition.definitionIndex;
  };

  const rootDefinitionIndex = await prepare(
    rootInvocation,
    options.resourceName,
    rootContent
  );
  const definitions = mutable.map((definition): NativePdfFormDefinition => {
    if (
      !definition.content || !definition.preparedContent ||
      !definition.formResources || !definition.imageResourceNames ||
      !definition.resourceReferences ||
      definition.optionalContentIndex === undefined ||
      definition.defaultVisible === undefined
    ) {
      throw new PdfError("invalid-object", "A scoped Form definition was not completely resolved.", {
        pageIndex: options.pageIndex,
        details: { reason: "form-definition-incomplete" }
      });
    }
    return Object.freeze({
      definitionIndex: definition.definitionIndex,
      form: definition.invocation.form,
      resourceName: definition.resourceName,
      content: definition.content,
      preparedContent: definition.preparedContent,
      formResources: definition.formResources,
      imageResourceNames: definition.imageResourceNames,
      resources: definition.invocation.form.resources,
      resourceReferences: definition.resourceReferences,
      optionalContentIndex: definition.optionalContentIndex,
      defaultVisible: definition.defaultVisible
    });
  });
  validateAcyclicDefinitions(definitions, options.pageIndex);
  validateDefinitionDepth(
    definitions,
    [rootDefinitionIndex],
    registry.formDepthLimit,
    options.pageIndex
  );
  return Object.freeze({
    pageForms: new Map([[options.resourceName, rootDefinitionIndex]]),
    definitions: Object.freeze(definitions),
    annotationPlacements: Object.freeze([])
  });
}

/**
 * Build a Form graph rooted at the `Do` operators in an arbitrary reusable
 * content stream. The supplied dictionary is already the owner's effective
 * resource scope, so local definitions shadow enclosing resources exactly as
 * required by PDF resource lookup.
 */
export async function buildNativePdfResourceFormDefinitionGraph(
  document: NativePdfDocument,
  registry: NativePdfFormAppearanceRegistry,
  resources: PdfDictionary,
  resourceReferences: DensePdfResourceReferences,
  options: NativePdfResourceFormGraphOptions
): Promise<NativePdfFormDefinitionGraph> {
  throwIfAborted(options.signal);
  const byForm = new WeakMap<NativePdfForm, MutableDefinition>();
  const mutable: MutableDefinition[] = [];

  const prepare = async (
    invocation: NativePdfFormInvocation,
    resourceName: string
  ): Promise<number> => {
    throwIfAborted(options.signal);
    const existing = byForm.get(invocation.form);
    if (existing) return existing.definitionIndex;
    if (mutable.length >= document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "Referenced Form definitions exceed the object-cache limit.", {
        pageIndex: options.pageIndex,
        details: {
          reason: "form-definition-count",
          maxFormDefinitions: document.limits.maxCachedObjects
        }
      });
    }
    const definition: MutableDefinition = {
      definitionIndex: mutable.length,
      invocation,
      resourceName
    };
    mutable.push(definition);
    byForm.set(invocation.form, definition);
    const association = await resolveFormOptionalContent(
      invocation.form,
      options.optionalContent,
      options.signal
    );
    definition.optionalContentIndex = association.optionalContentIndex;
    definition.defaultVisible = association.defaultVisible;
    if (!association.defaultVisible) {
      definition.content = new Uint8Array(0);
      definition.preparedContent = prepareFormInlineContent(
        document,
        definition.content,
        options.signal
      );
      definition.formResources = new Map();
      definition.imageResourceNames = Object.freeze([]);
      definition.resourceReferences = scanPreparedResourceReferencesFastOrExact(
        definition.preparedContent.segments,
        { signal: options.signal }
      ).references;
      return definition.definitionIndex;
    }
    const content = await registry.decodeFormContent(invocation.form, options.signal);
    const preparedContent = prepareFormInlineContent(document, content, options.signal);
    const references = scanPreparedResourceReferencesFastOrExact(
      preparedContent.segments,
      { signal: options.signal }
    ).references;
    const formResources = new Map<string, number>();
    const imageResourceNames: string[] = [];
    const xObjects = await classifyNativePdfXObjectReferences(
      document,
      invocation.form.resources,
      references.xObjects,
      options.signal
    );
    for (const xObject of xObjects) {
      if (xObject.kind === "Image") {
        imageResourceNames.push(xObject.resourceName);
        continue;
      }
      const nested = await registry.resolveNestedForm(
        invocation,
        xObject.resourceName,
        options.signal
      );
      formResources.set(
        xObject.resourceName,
        await prepare(nested, xObject.resourceName)
      );
    }
    definition.content = content;
    definition.preparedContent = preparedContent;
    definition.formResources = formResources;
    definition.imageResourceNames = Object.freeze(imageResourceNames);
    definition.resourceReferences = references;
    return definition.definitionIndex;
  };

  const pageForms = new Map<string, number>();
  const xObjects = await classifyNativePdfXObjectReferences(
    document,
    resources,
    resourceReferences.xObjects,
    options.signal
  );
  for (const xObject of xObjects) {
    if (xObject.kind !== "Form") continue;
    const invocation = await registry.resolveScopedForm(
      resources,
      xObject.resourceName,
      options.ownerLabel,
      options.signal
    );
    pageForms.set(
      xObject.resourceName,
      await prepare(invocation, xObject.resourceName)
    );
  }

  const definitions = mutable.map((definition): NativePdfFormDefinition => {
    if (
      !definition.content || !definition.preparedContent ||
      !definition.formResources || !definition.imageResourceNames ||
      !definition.resourceReferences ||
      definition.optionalContentIndex === undefined ||
      definition.defaultVisible === undefined
    ) {
      throw new PdfError("invalid-object", "A scoped Form definition was not completely resolved.", {
        pageIndex: options.pageIndex,
        details: { reason: "form-definition-incomplete" }
      });
    }
    return Object.freeze({
      definitionIndex: definition.definitionIndex,
      form: definition.invocation.form,
      resourceName: definition.resourceName,
      content: definition.content,
      preparedContent: definition.preparedContent,
      formResources: definition.formResources,
      imageResourceNames: definition.imageResourceNames,
      resources: definition.invocation.form.resources,
      resourceReferences: definition.resourceReferences,
      optionalContentIndex: definition.optionalContentIndex,
      defaultVisible: definition.defaultVisible
    });
  });
  validateAcyclicDefinitions(definitions, options.pageIndex);
  validateDefinitionDepth(
    definitions,
    [...pageForms.values()],
    registry.formDepthLimit,
    options.pageIndex
  );
  return Object.freeze({
    pageForms,
    definitions: Object.freeze(definitions),
    annotationPlacements: Object.freeze([])
  });
}

async function resolveFormOptionalContent(
  form: NativePdfForm,
  registry: NativeOptionalContentRegistry | undefined,
  signal?: AbortSignal
): Promise<{ optionalContentIndex: number; defaultVisible: boolean }> {
  const raw = form.dictionary.get("OC");
  if (raw === undefined || raw === null) {
    return { optionalContentIndex: -1, defaultVisible: true };
  }
  if (!registry) {
    throw new PdfError(
      "unsupported-content",
      `Form XObject ${form.id} has an /OC association that was not evaluated.`,
      { details: { reason: "form-optional-content", formId: form.id } }
    );
  }
  const membership = await registry.resolvePropertyValue(raw, signal);
  if (!membership) {
    throw new PdfError(
      "invalid-object",
      `Form XObject ${form.id} /OC does not resolve to an OCG or OCMD membership.`,
      { details: { reason: "form-optional-content-invalid", formId: form.id } }
    );
  }
  return {
    optionalContentIndex: membership.index,
    defaultVisible: membership.defaultVisible
  };
}

function validateDefinitionDepth(
  definitions: readonly NativePdfFormDefinition[],
  roots: readonly number[],
  maxDepth: number,
  pageIndex: number
): void {
  const deepestVisit = new Uint32Array(definitions.length);
  const visit = (index: number, depth: number): void => {
    if (depth > maxDepth) {
      throw new PdfError(
        "resource-limit",
        `Form XObject invocation exceeds the configured depth limit of ${maxDepth}.`,
        {
          pageIndex,
          details: { reason: "form-depth", maxFormDepth: maxDepth }
        }
      );
    }
    if (deepestVisit[index] >= depth) return;
    deepestVisit[index] = depth;
    for (const child of definitions[index].formResources.values()) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 1);
}

export interface NativePdfXObjectReference {
  readonly resourceName: string;
  readonly kind: "Form" | "Image";
}

/** Classify one exact first-use `Do` manifest without touching unused entries. */
export async function classifyNativePdfXObjectReferences(
  document: NativePdfDocument,
  resources: PdfDictionary,
  resourceNames: readonly string[],
  signal?: AbortSignal
): Promise<readonly NativePdfXObjectReference[]> {
  throwIfAborted(signal);
  if (resourceNames.length === 0) return Object.freeze([]);
  const xObjectValue = resources.get("XObject");
  if (xObjectValue === undefined || xObjectValue === null) {
    throw new PdfError("unsupported-content", "Referenced XObjects have no resource dictionary.", {
      details: { reason: "form-resource-missing", resourceName: resourceNames[0] }
    });
  }
  const xObjects = await document.resolveDictionary(xObjectValue, signal);
  const result: NativePdfXObjectReference[] = [];
  for (const resourceName of resourceNames) {
    throwIfAborted(signal);
    const raw = xObjects.get(resourceName);
    if (raw === undefined || raw === null) {
      throw new PdfError("unsupported-content", `XObject /${resourceName} is missing.`, {
        details: { reason: "form-resource-missing", resourceName }
      });
    }
    const resolved = await document.resolveValue(raw, signal);
    if (!isPdfStream(resolved)) {
      throw new PdfError("unsupported-content", `XObject /${resourceName} is not a stream.`, {
        details: { reason: "xobject-not-stream", resourceName }
      });
    }
    const subtype = await document.resolveValue(resolved.dictionary.get("Subtype"), signal);
    const kind = isPdfName(subtype, "Form")
      ? "Form"
      : isPdfName(subtype, "Image")
        ? "Image"
        : null;
    if (!kind) {
      throw new PdfError("unsupported-content", `XObject /${resourceName} has an unsupported subtype.`, {
        details: {
          reason: "xobject-subtype-unsupported",
          resourceName,
          subtype: isPdfName(subtype) ? subtype.value : null
        }
      });
    }
    result.push(Object.freeze({ resourceName, kind }));
  }
  return Object.freeze(result);
}

function joinContent(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, chunks.length - 1);
  const result = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    if (index > 0) result[offset++] = 0x0a;
    result.set(chunks[index], offset);
    offset += chunks[index].length;
  }
  return result;
}

function prepareFormInlineContent(
  document: NativePdfDocument,
  content: Uint8Array,
  signal?: AbortSignal
): NativeInlineImageResult {
  return prepareNativeInlineImages(content, {
    signal,
    limits: {
      maxImages: Math.min(
        DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxImages,
        document.limits.maxCommandsPerPage
      ),
      maxPayloadBytes: Math.min(
        DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxPayloadBytes,
        document.limits.maxDecodedStreamBytes
      ),
      maxScanBytes: Math.min(
        DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxScanBytes,
        document.limits.maxDecodedStreamBytes
      ),
      maxNestingDepth: Math.min(
        DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxNestingDepth,
        document.limits.maxRecursionDepth
      )
    }
  });
}

function validateAcyclicDefinitions(
  definitions: readonly NativePdfFormDefinition[],
  pageIndex: number
): void {
  const state = new Uint8Array(definitions.length);
  const visit = (index: number): void => {
    if (state[index] === 2) return;
    if (state[index] === 1) {
      throw new PdfError("unsupported-content", "The referenced Form program graph is cyclic.", {
        pageIndex,
        details: { reason: "form-cycle", definitionIndex: index }
      });
    }
    state[index] = 1;
    for (const child of definitions[index].formResources.values()) visit(child);
    state[index] = 2;
  };
  for (let index = 0; index < definitions.length; index += 1) visit(index);
}
