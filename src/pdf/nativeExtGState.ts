import {
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  pdfRefKey,
  type PdfDictionary,
  type PdfRef,
  type PdfStream,
  type PdfValue
} from "./nativeCos";
import {
  NativePdfColorRegistry,
  type NativePdfColorSpaceDescription
} from "./nativeColor";
import type { NativePdfDocument } from "./nativeDocument";
import type { NativePdfFunctionRegistry } from "./nativeFunctions";
import {
  type NativePdfForm,
  type NativePdfMatrix,
  type NativePdfRectangle,
  type NativePdfResourceOrigin,
  type NativePdfTransparencyGroup
} from "./nativeForms";
import { PdfError, throwIfAborted } from "./nativeTypes";
import type { HeprCompositeGroup, PdfBlendMode } from "../heprDocumentData";

export type NativePdfBlendModeName = PdfBlendMode | "Compatible";

export type NativePdfRenderingIntent =
  | "AbsoluteColorimetric"
  | "RelativeColorimetric"
  | "Saturation"
  | "Perceptual";

export interface NativePdfLineDash {
  readonly array: readonly number[];
  readonly phase: number;
}

export interface NativePdfSoftMaskGroupDescription {
  readonly isolated: boolean;
  readonly knockout: boolean;
  /** Registry-local color index. Page-store remapping happens during integration. */
  readonly colorSpaceIndex: number;
  readonly colorSpace: Readonly<NativePdfColorSpaceDescription> | null;
  /** The resolved outer color-space object retained for scoped compilation. */
  readonly rawColorSpace: PdfValue | null;
}

/**
 * A source-backed Form handle for a soft-mask group. `form.resources` is the
 * exact effective scope (local `/Resources`, inherited enclosing resources, or
 * the immutable empty scope). The raw stream remains available through the
 * registry's `decodeSoftMaskFormContent()` method and is never approximated.
 */
export interface NativePdfSoftMaskFormHandle {
  readonly form: NativePdfForm;
  readonly group: Readonly<NativePdfSoftMaskGroupDescription>;
}

export interface NativePdfSoftMaskNone {
  readonly kind: "none";
}

export interface NativePdfSoftMaskDefinition {
  readonly kind: "mask";
  readonly subtype: "Alpha" | "Luminosity";
  readonly formHandle: Readonly<NativePdfSoftMaskFormHandle>;
  /** Components in the Form transparency-group blending space, or null. */
  readonly backdropColor: readonly number[] | null;
  /** Registry-local native function index; -1 means the identity transfer. */
  readonly transferFunctionIndex: number;
}

export type NativePdfSoftMaskDescription =
  | NativePdfSoftMaskNone
  | NativePdfSoftMaskDefinition;

export interface NativePdfExtGStateDescription {
  readonly index: number;
  readonly id: string;
  readonly ref: PdfRef | null;
  readonly dictionary: PdfDictionary;
  /** Resource scope used by named color spaces and an inherited soft-mask Form. */
  readonly resources: PdfDictionary;

  /** Null means this dictionary does not modify the corresponding parameter. */
  readonly strokingAlpha: number | null;
  readonly nonstrokingAlpha: number | null;
  /** Exact source candidates; unknown names are retained when a later fallback is supported. */
  readonly blendModeCandidates: readonly string[] | null;
  /** Supported candidates in source order. */
  readonly blendModes: readonly NativePdfBlendModeName[] | null;
  /** First recognized candidate, with `/Compatible` normalized to `Normal`. */
  readonly effectiveBlendMode: PdfBlendMode | null;
  readonly alphaIsShape: boolean | null;
  readonly textKnockout: boolean | null;
  readonly strokingOverprint: boolean | null;
  /** `/op` when present, otherwise `/OP` when present, otherwise null. */
  readonly nonstrokingOverprint: boolean | null;
  readonly overprintMode: 0 | 1 | null;
  readonly renderingIntent: NativePdfRenderingIntent | null;
  readonly flatnessTolerance: number | null;
  readonly smoothnessTolerance: number | null;
  readonly strokeAdjustment: boolean | null;
  readonly softMask: Readonly<NativePdfSoftMaskDescription> | null;
  /** Identity/Default transfer entries are retained as a no-op; functions fail. */
  readonly transferIsIdentity: boolean | null;

  /** Common line-state entries carried by ExtGState dictionaries. */
  readonly lineWidth: number | null;
  readonly lineCap: 0 | 1 | 2 | null;
  readonly lineJoin: 0 | 1 | 2 | null;
  readonly miterLimit: number | null;
  readonly lineDash: Readonly<NativePdfLineDash> | null;
}

export interface NativePdfExtGStateOptions {
  /** May lower, but never raise, the document recursion ceiling. */
  readonly maxExtGStateDepth?: number;
  /** May lower, but never raise, the document cached-object ceiling. */
  readonly maxExtGStates?: number;
}

/**
 * Intermediate HEPR compositing templates, two per ExtGState (stroke then
 * nonstroke). They are deliberately not final page groups: omitted PDF entries
 * must first inherit the interpreter's current state. `alphaSpecified` and
 * `blendModeSpecified` distinguish placeholders from explicit values.
 *
 * Soft-mask Form programs, soft-mask groups, backdrop paints, and page-local
 * blending color indexes do not exist at registry time, so every corresponding
 * HEPR/index sidecar is initialized to -1. Source registry indexes and Form ids
 * are retained separately for deterministic later remapping.
 */
export interface NativePdfExtGStateGroupSidecars {
  readonly groups: readonly HeprCompositeGroup[];
  readonly strokingGroupIndices: Uint32Array;
  readonly nonstrokingGroupIndices: Uint32Array;
  /** Two entries per ExtGState, in the same order as `groups`. */
  readonly alphaSpecified: Uint8Array;
  /** One entry per ExtGState; distinguishes omitted `/AIS` from explicit false. */
  readonly alphaIsShapeSpecified: Uint8Array;
  readonly blendModeSpecified: Uint8Array;
  /** 0 absent, 1 explicit None, 2 Alpha mask, 3 Luminosity mask. */
  readonly softMaskKinds: Uint8Array;
  readonly softMaskProgramIndices: Int32Array;
  readonly softMaskGroupIndices: Int32Array;
  readonly backdropPaintIndices: Int32Array;
  readonly blendingColorSpaceIndices: Int32Array;
  readonly sourceColorSpaceIndices: Int32Array;
  readonly transferFunctionIndices: Int32Array;
  readonly softMaskFormIds: readonly (string | null)[];
}

interface ExtGStateRecord {
  readonly description: Readonly<NativePdfExtGStateDescription>;
}

interface EffectiveResourceScope {
  readonly dictionary: PdfDictionary;
  readonly origin: NativePdfResourceOrigin;
  readonly identity: string;
}

interface ResolutionStack {
  readonly refs: ReadonlySet<string>;
  readonly objects: ReadonlySet<object>;
  readonly resourceNames: ReadonlySet<string>;
  readonly depth: number;
}

interface ParsedSoftMaskForm {
  readonly handle: Readonly<NativePdfSoftMaskFormHandle>;
  readonly stream: PdfStream;
}

interface BlendModeSelection {
  readonly candidates: readonly string[];
  readonly supported: readonly NativePdfBlendModeName[];
  readonly effective: PdfBlendMode;
}

const EMPTY_RESOURCES: PdfDictionary = new Map();
const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 1, 0, 0]) as NativePdfMatrix;
const SOFT_MASK_NONE: Readonly<NativePdfSoftMaskNone> = Object.freeze({ kind: "none" });
const MAX_UINT32 = 0xffff_ffff;
const MAX_INT32 = 0x7fff_ffff;

const BLEND_MODES: ReadonlySet<string> = new Set([
  "Normal", "Compatible", "Multiply", "Screen", "Overlay", "Darken", "Lighten",
  "ColorDodge", "ColorBurn", "HardLight", "SoftLight", "Difference", "Exclusion",
  "Hue", "Saturation", "Color", "Luminosity"
]);

const RENDERING_INTENTS: ReadonlySet<string> = new Set([
  "AbsoluteColorimetric", "RelativeColorimetric", "Saturation", "Perceptual"
]);

const SUPPORTED_KEYS: ReadonlySet<string> = new Set([
  "Type", "LW", "LC", "LJ", "ML", "D", "RI", "OP", "op", "OPM", "TR", "TR2",
  "FL", "SM", "SA", "BM", "SMask", "CA", "ca", "AIS", "TK"
]);
const SOFT_MASK_KEYS: ReadonlySet<string> = new Set(["Type", "S", "G", "BC", "TR"]);
const TRANSPARENCY_GROUP_KEYS: ReadonlySet<string> = new Set(["Type", "S", "CS", "I", "K"]);

const UNSUPPORTED_KEYS: ReadonlyMap<string, string> = new Map([
  ["Font", "extgstate-font-unsupported"],
  ["BG", "extgstate-black-generation-unsupported"],
  ["BG2", "extgstate-black-generation-unsupported"],
  ["UCR", "extgstate-undercolor-removal-unsupported"],
  ["UCR2", "extgstate-undercolor-removal-unsupported"],
  ["HT", "extgstate-halftone-unsupported"]
]);

/**
 * Lazy, resource-scoped registry for PDF extended graphics states and soft
 * masks. Definition identity includes the enclosing resource dictionary,
 * because a shared indirect object can legally resolve named group color
 * spaces differently in different Forms/pages.
 */
export class NativePdfExtGStateRegistry {
  readonly document: NativePdfDocument;
  readonly colors: NativePdfColorRegistry;
  readonly functions: NativePdfFunctionRegistry;

  private readonly maxDepth: number;
  private readonly maxExtGStates: number;
  private readonly records: ExtGStateRecord[] = [];
  private readonly refCache = new Map<string, Promise<number>>();
  private readonly objectCache = new WeakMap<object, Map<number, Promise<number>>>();
  private readonly resourceCache = new WeakMap<PdfDictionary, Map<string, Promise<number>>>();
  private readonly pageResourceCache = new Map<number, PdfDictionary>();
  private readonly scopeIds = new WeakMap<PdfDictionary, number>();
  private readonly objectIds = new WeakMap<object, number>();
  private readonly softMaskRefCache = new Map<string, Promise<ParsedSoftMaskForm>>();
  private readonly softMaskObjectCache = new WeakMap<object, Map<number, Promise<ParsedSoftMaskForm>>>();
  private readonly streamByForm = new WeakMap<NativePdfForm, PdfStream>();
  private readonly decodedFormCache = new WeakMap<NativePdfForm, Promise<Uint8Array>>();
  private nextScopeId = 1;
  private nextObjectId = 1;

  constructor(
    document: NativePdfDocument,
    colors?: NativePdfColorRegistry,
    options: NativePdfExtGStateOptions = {}
  ) {
    this.document = document;
    this.colors = colors ?? new NativePdfColorRegistry(document);
    this.functions = this.colors.functions;
    this.maxDepth = boundedOption(
      options.maxExtGStateDepth,
      document.limits.maxRecursionDepth,
      "maxExtGStateDepth"
    );
    this.maxExtGStates = boundedOption(
      options.maxExtGStates,
      document.limits.maxCachedObjects,
      "maxExtGStates"
    );
  }

  get size(): number {
    return this.records.length;
  }

  get extGStateDepthLimit(): number {
    return this.maxDepth;
  }

  /** Resolve an ExtGState name from one page's inherited resource scope. */
  async resolvePageExtGState(
    pageIndex: number,
    resourceName: string,
    signal?: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    const page = this.document.getPage(pageIndex);
    let resources = this.pageResourceCache.get(pageIndex);
    if (!resources) {
      if (page.resources === undefined || page.resources === null) {
        throw extGStateError(`Page ${pageIndex} has no resources for /${normalizeName(resourceName)}.`, {
          reason: "missing-page-resources",
          pageIndex
        });
      }
      resources = await this.document.resolveDictionary(page.resources, signal);
      this.pageResourceCache.set(pageIndex, resources);
    }
    return await this.resolveNamed(resources, resourceName, emptyStack(), `page ${pageIndex}`, signal);
  }

  /** Resolve an ExtGState name in an already-resolved Form/pattern scope. */
  async resolveExtGState(
    resources: PdfDictionary,
    resourceName: string,
    signal?: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    return await this.resolveNamed(resources, resourceName, emptyStack(), "resource scope", signal);
  }

  /** Add a direct/reference/name value with an optional enclosing scope. */
  async add(
    value: PdfValue,
    resources?: PdfDictionary,
    signal?: AbortSignal
  ): Promise<number> {
    return await this.addInternal(value, resources, emptyStack(), "direct ExtGState", signal);
  }

  describe(index: number): Readonly<NativePdfExtGStateDescription> {
    return this.getRecord(index).description;
  }

  /** Decode a registry-owned soft-mask Form under the document stream limit. */
  async decodeSoftMaskFormContent(
    form: NativePdfForm,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    throwIfAborted(signal);
    const stream = this.streamByForm.get(form);
    if (!stream) throw new TypeError("The soft-mask Form was not created by this registry.");
    const cached = this.decodedFormCache.get(form);
    if (cached) return await cached;
    const pending = this.document.decodeStream(stream, signal).catch((error) => {
      this.decodedFormCache.delete(form);
      throw error;
    });
    this.decodedFormCache.set(form, pending);
    return await pending;
  }

  buildGroupSidecars(): NativePdfExtGStateGroupSidecars {
    const count = this.records.length;
    const groups: HeprCompositeGroup[] = [];
    const strokingGroupIndices = new Uint32Array(count);
    const nonstrokingGroupIndices = new Uint32Array(count);
    const alphaSpecified = new Uint8Array(count * 2);
    const alphaIsShapeSpecified = new Uint8Array(count);
    const blendModeSpecified = new Uint8Array(count);
    const softMaskKinds = new Uint8Array(count);
    const softMaskProgramIndices = new Int32Array(count);
    const softMaskGroupIndices = new Int32Array(count);
    const backdropPaintIndices = new Int32Array(count);
    const blendingColorSpaceIndices = new Int32Array(count);
    const sourceColorSpaceIndices = new Int32Array(count);
    const transferFunctionIndices = new Int32Array(count);
    const softMaskFormIds: (string | null)[] = [];

    softMaskProgramIndices.fill(-1);
    softMaskGroupIndices.fill(-1);
    backdropPaintIndices.fill(-1);
    blendingColorSpaceIndices.fill(-1);
    sourceColorSpaceIndices.fill(-1);
    transferFunctionIndices.fill(-1);

    for (let index = 0; index < count; index += 1) {
      const state = this.records[index].description;
      const blendMode = state.effectiveBlendMode ?? "Normal";
      const strokeIndex = groups.length;
      groups.push(groupTemplate(
        state.strokingAlpha ?? 1,
        state.alphaIsShape ?? false,
        blendMode
      ));
      const nonstrokeIndex = groups.length;
      groups.push(groupTemplate(
        state.nonstrokingAlpha ?? 1,
        state.alphaIsShape ?? false,
        blendMode
      ));
      strokingGroupIndices[index] = strokeIndex;
      nonstrokingGroupIndices[index] = nonstrokeIndex;
      alphaSpecified[strokeIndex] = state.strokingAlpha === null ? 0 : 1;
      alphaSpecified[nonstrokeIndex] = state.nonstrokingAlpha === null ? 0 : 1;
      alphaIsShapeSpecified[index] = state.alphaIsShape === null ? 0 : 1;
      blendModeSpecified[index] = state.blendModeCandidates === null ? 0 : 1;

      const mask = state.softMask;
      if (mask === null) {
        softMaskFormIds.push(null);
      } else if (mask.kind === "none") {
        softMaskKinds[index] = 1;
        softMaskFormIds.push(null);
      } else {
        softMaskKinds[index] = mask.subtype === "Alpha" ? 2 : 3;
        sourceColorSpaceIndices[index] = mask.formHandle.group.colorSpaceIndex;
        transferFunctionIndices[index] = mask.transferFunctionIndex;
        softMaskFormIds.push(mask.formHandle.form.id);
      }
    }
    return Object.freeze({
      groups: Object.freeze(groups),
      strokingGroupIndices,
      nonstrokingGroupIndices,
      alphaSpecified,
      alphaIsShapeSpecified,
      blendModeSpecified,
      softMaskKinds,
      softMaskProgramIndices,
      softMaskGroupIndices,
      backdropPaintIndices,
      blendingColorSpaceIndices,
      sourceColorSpaceIndices,
      transferFunctionIndices,
      softMaskFormIds: Object.freeze(softMaskFormIds)
    });
  }

  private async addInternal(
    value: PdfValue,
    resources: PdfDictionary | undefined,
    stack: ResolutionStack,
    label: string,
    signal?: AbortSignal,
    sourceRef: PdfRef | null = null
  ): Promise<number> {
    throwIfAborted(signal);
    this.checkDepth(stack);
    if (isPdfRef(value)) {
      const identity = pdfRefKey(value);
      if (stack.refs.has(identity)) {
        throw extGStateError("An ExtGState reference graph contains a cycle.", {
          reason: "extgstate-reference-cycle",
          objectNumber: value.objectNumber
        });
      }
      const key = `${identity}@${this.scopeId(resources)}`;
      const cached = this.refCache.get(key);
      if (cached) return await cached;
      const refs = new Set(stack.refs);
      refs.add(identity);
      const pending = this.document.resolveObject(value, signal).then((resolved) =>
        this.addInternal(
          resolved,
          resources,
          { ...stack, refs, depth: stack.depth + 1 },
          label,
          signal,
          sourceRef ?? value
        )
      );
      this.refCache.set(key, pending);
      try {
        return await pending;
      } catch (error) {
        this.refCache.delete(key);
        throw error;
      }
    }
    if (isPdfName(value)) {
      if (!resources) {
        throw extGStateError(`ExtGState name /${value.value} has no resource scope.`, {
          reason: "missing-extgstate-resource-scope",
          resourceName: value.value
        });
      }
      return await this.resolveNamed(resources, value.value, stack, label, signal);
    }
    if (!isPdfDictionary(value)) {
      throw new PdfError("invalid-object", `${label} is not an ExtGState dictionary.`, {
        details: { feature: "ext-gstate", reason: "invalid-extgstate-object" }
      });
    }
    if (stack.objects.has(value)) {
      throw extGStateError("A direct ExtGState graph contains a cycle.", {
        reason: "extgstate-direct-cycle"
      });
    }
    const scope = this.scopeId(resources);
    let scopedCache = this.objectCache.get(value);
    if (!scopedCache) {
      scopedCache = new Map();
      this.objectCache.set(value, scopedCache);
    }
    const cached = scopedCache.get(scope);
    if (cached) return await cached;
    const objects = new Set(stack.objects);
    objects.add(value);
    const pending = this.parseAndAppend(
      value,
      resources ?? EMPTY_RESOURCES,
      { ...stack, objects },
      label,
      sourceRef,
      signal
    );
    scopedCache.set(scope, pending);
    try {
      return await pending;
    } catch (error) {
      scopedCache.delete(scope);
      throw error;
    }
  }

  private async resolveNamed(
    resources: PdfDictionary,
    rawName: string,
    stack: ResolutionStack,
    ownerLabel: string,
    signal?: AbortSignal
  ): Promise<number> {
    this.checkDepth(stack);
    const name = normalizeName(rawName);
    const identity = `${this.scopeId(resources)}:${name}`;
    if (stack.resourceNames.has(identity)) {
      throw extGStateError(`ExtGState resource /${name} is recursive.`, {
        reason: "extgstate-resource-cycle",
        resourceName: name
      });
    }
    const rawResources = resources.get("ExtGState");
    if (rawResources === undefined || rawResources === null) {
      throw extGStateError(`${ownerLabel} has no /ExtGState resources for /${name}.`, {
        reason: "missing-extgstate-resources",
        resourceName: name
      });
    }
    const extGStates = await this.document.resolveDictionary(rawResources, signal);
    let cache = this.resourceCache.get(resources);
    if (!cache) {
      cache = new Map();
      this.resourceCache.set(resources, cache);
    }
    const cached = cache.get(name);
    if (cached) return await cached;
    const raw = extGStates.get(name);
    if (raw === undefined || raw === null) {
      throw extGStateError(`Unknown ExtGState resource /${name}.`, {
        reason: "missing-extgstate-resource",
        resourceName: name
      });
    }
    const resourceNames = new Set(stack.resourceNames);
    resourceNames.add(identity);
    const pending = this.addInternal(
      raw,
      resources,
      { ...stack, resourceNames, depth: stack.depth + 1 },
      `ExtGState /${name}`,
      signal
    ).catch((error) => {
      cache!.delete(name);
      throw error;
    });
    cache.set(name, pending);
    return await pending;
  }

  private async parseAndAppend(
    dictionary: PdfDictionary,
    resources: PdfDictionary,
    stack: ResolutionStack,
    label: string,
    sourceRef: PdfRef | null,
    signal?: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    await this.validateEntries(dictionary, label, signal);
    const type = await this.document.resolveValue(dictionary.get("Type"), signal);
    if (type !== undefined && type !== null && !isPdfName(type, "ExtGState")) {
      throw new PdfError("invalid-object", `${label} /Type is not /ExtGState.`, {
        details: { feature: "ext-gstate", reason: "invalid-extgstate-marker" }
      });
    }

    const strokingAlpha = await optionalBoundedNumber(this.document, dictionary, "CA", 0, 1, label, signal);
    const nonstrokingAlpha = await optionalBoundedNumber(this.document, dictionary, "ca", 0, 1, label, signal);
    const blendModeSelection = await this.readBlendModes(dictionary, label, signal);
    const blendModeCandidates = blendModeSelection?.candidates ?? null;
    const blendModes = blendModeSelection?.supported ?? null;
    const effectiveBlendMode = blendModeSelection?.effective ?? null;
    const alphaIsShape = await optionalBoolean(this.document, dictionary, "AIS", label, signal);
    const textKnockout = await optionalBoolean(this.document, dictionary, "TK", label, signal);
    const strokingOverprint = await optionalBoolean(this.document, dictionary, "OP", label, signal);
    const explicitNonstrokingOverprint = await optionalBoolean(this.document, dictionary, "op", label, signal);
    const nonstrokingOverprint = explicitNonstrokingOverprint ?? strokingOverprint;
    const overprintModeValue = await optionalInteger(this.document, dictionary, "OPM", label, signal);
    if (overprintModeValue !== null && overprintModeValue !== 0 && overprintModeValue !== 1) {
      throw invalidEntry(label, "OPM", "must be 0 or 1", "extgstate-overprint-mode-invalid");
    }
    const renderingIntent = await this.readRenderingIntent(dictionary, label, signal);
    const flatnessTolerance = await optionalBoundedNumber(this.document, dictionary, "FL", 0, 100, label, signal);
    const smoothnessTolerance = await optionalBoundedNumber(this.document, dictionary, "SM", 0, 1, label, signal);
    const strokeAdjustment = await optionalBoolean(this.document, dictionary, "SA", label, signal);
    const transferIsIdentity = await this.readTopLevelTransfer(dictionary, label, signal);
    const softMask = await this.readSoftMask(dictionary, resources, stack, label, signal);

    const lineWidth = await optionalMinimumNumber(this.document, dictionary, "LW", 0, label, signal);
    const lineCapValue = await optionalInteger(this.document, dictionary, "LC", label, signal);
    const lineCap = validateLineStyleInteger(lineCapValue, label, "LC") as 0 | 1 | 2 | null;
    const lineJoinValue = await optionalInteger(this.document, dictionary, "LJ", label, signal);
    const lineJoin = validateLineStyleInteger(lineJoinValue, label, "LJ") as 0 | 1 | 2 | null;
    const miterLimit = await optionalMinimumNumber(this.document, dictionary, "ML", 1, label, signal);
    const lineDash = await this.readLineDash(dictionary, label, signal);

    if (this.records.length >= this.maxExtGStates || this.records.length > MAX_INT32) {
      throw new PdfError("resource-limit", `ExtGState count exceeds ${this.maxExtGStates}.`, {
        details: {
          feature: "ext-gstate",
          reason: "extgstate-count",
          limit: this.maxExtGStates
        }
      });
    }
    const index = this.records.length;
    const sourceIdentity = sourceRef
      ? `ref:${pdfRefKey(sourceRef)}`
      : `direct:${this.objectIdentity(dictionary)}`;
    const description: NativePdfExtGStateDescription = Object.freeze({
      index,
      id: `${sourceIdentity}|resources:${this.scopeId(resources)}`,
      ref: sourceRef,
      dictionary,
      resources,
      strokingAlpha,
      nonstrokingAlpha,
      blendModeCandidates,
      blendModes,
      effectiveBlendMode,
      alphaIsShape,
      textKnockout,
      strokingOverprint,
      nonstrokingOverprint,
      overprintMode: overprintModeValue as 0 | 1 | null,
      renderingIntent,
      flatnessTolerance,
      smoothnessTolerance,
      strokeAdjustment,
      softMask,
      transferIsIdentity,
      lineWidth,
      lineCap,
      lineJoin,
      miterLimit,
      lineDash
    });
    this.records.push(Object.freeze({ description }));
    return index;
  }

  private async validateEntries(
    dictionary: PdfDictionary,
    label: string,
    signal?: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal);
    for (const key of dictionary.keys()) {
      const reason = UNSUPPORTED_KEYS.get(key);
      if (reason) {
        const code = key === "Font" ? "unsupported-font" : "unsupported-content";
        throw new PdfError(code, `${label} /${key} is unsupported by native compositing.`, {
          details: { feature: "ext-gstate", reason, entry: key }
        });
      }
      if (!SUPPORTED_KEYS.has(key)) {
        throw extGStateError(`${label} contains unsupported entry /${key}.`, {
          reason: "extgstate-entry-unsupported",
          entry: key
        });
      }
    }
  }

  private async readBlendModes(
    dictionary: PdfDictionary,
    label: string,
    signal?: AbortSignal
  ): Promise<Readonly<BlendModeSelection> | null> {
    const raw = await this.document.resolveValue(dictionary.get("BM"), signal);
    if (raw === undefined || raw === null) return null;
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.length === 0) {
      throw invalidEntry(label, "BM", "must not be an empty array", "extgstate-blend-mode-invalid");
    }
    const candidates: string[] = [];
    const modes: NativePdfBlendModeName[] = [];
    let effective: PdfBlendMode | null = null;
    for (const item of values) {
      const resolved = await this.document.resolveValue(item, signal);
      if (!isPdfName(resolved)) {
        throw invalidEntry(label, "BM", "contains a non-name candidate", "extgstate-blend-mode-invalid");
      }
      candidates.push(resolved.value);
      if (BLEND_MODES.has(resolved.value)) {
        const mode = resolved.value as NativePdfBlendModeName;
        modes.push(mode);
        effective ??= normalizeBlendMode(mode);
      }
    }
    if (effective === null) {
      throw extGStateError(`${label} has no supported blend-mode candidate.`, {
        reason: "extgstate-blend-mode-unsupported",
        blendMode: candidates[0] ?? null
      });
    }
    return Object.freeze({
      candidates: Object.freeze(candidates),
      supported: Object.freeze(modes),
      effective
    });
  }

  private async readRenderingIntent(
    dictionary: PdfDictionary,
    label: string,
    signal?: AbortSignal
  ): Promise<NativePdfRenderingIntent | null> {
    const value = await this.document.resolveValue(dictionary.get("RI"), signal);
    if (value === undefined || value === null) return null;
    if (!isPdfName(value) || !RENDERING_INTENTS.has(value.value)) {
      throw extGStateError(`${label} has unsupported rendering intent ${formatPdfValue(value)}.`, {
        reason: "extgstate-rendering-intent-unsupported",
        renderingIntent: isPdfName(value) ? value.value : null
      });
    }
    return value.value as NativePdfRenderingIntent;
  }

  private async readTopLevelTransfer(
    dictionary: PdfDictionary,
    label: string,
    signal?: AbortSignal
  ): Promise<boolean | null> {
    let present = false;
    if (dictionary.has("TR")) {
      present = true;
      const transfer = await this.document.resolveValue(dictionary.get("TR"), signal);
      if (!isPdfName(transfer, "Identity")) {
        throw extGStateError(`${label} /TR is not the identity transfer.`, {
          reason: "extgstate-transfer-unsupported",
          entry: "TR"
        });
      }
    }
    if (dictionary.has("TR2")) {
      present = true;
      const transfer = await this.document.resolveValue(dictionary.get("TR2"), signal);
      if (!isPdfName(transfer, "Identity") && !isPdfName(transfer, "Default")) {
        throw extGStateError(`${label} /TR2 is not an identity/default transfer.`, {
          reason: "extgstate-transfer-unsupported",
          entry: "TR2"
        });
      }
    }
    return present ? true : null;
  }

  private async readLineDash(
    dictionary: PdfDictionary,
    label: string,
    signal?: AbortSignal
  ): Promise<Readonly<NativePdfLineDash> | null> {
    const value = await this.document.resolveValue(dictionary.get("D"), signal);
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value) || value.length !== 2) {
      throw invalidEntry(label, "D", "must be [dashArray phase]", "extgstate-line-dash-invalid");
    }
    const rawArray = await this.document.resolveValue(value[0], signal);
    const phase = await this.document.resolveValue(value[1], signal);
    if (!Array.isArray(rawArray) || typeof phase !== "number" || !Number.isFinite(phase)) {
      throw invalidEntry(label, "D", "has invalid operands", "extgstate-line-dash-invalid");
    }
    const array: number[] = [];
    for (const raw of rawArray) {
      const component = await this.document.resolveValue(raw, signal);
      if (typeof component !== "number" || !Number.isFinite(component) || component < 0) {
        throw invalidEntry(label, "D", "contains an invalid dash length", "extgstate-line-dash-invalid");
      }
      array.push(component);
    }
    if (array.length > 0 && array.every((component) => component === 0)) {
      throw invalidEntry(label, "D", "cannot contain only zero lengths", "extgstate-line-dash-invalid");
    }
    return Object.freeze({ array: Object.freeze(array), phase });
  }

  private async readSoftMask(
    dictionary: PdfDictionary,
    resources: PdfDictionary,
    stack: ResolutionStack,
    label: string,
    signal?: AbortSignal
  ): Promise<Readonly<NativePdfSoftMaskDescription> | null> {
    if (!dictionary.has("SMask")) return null;
    const raw = dictionary.get("SMask");
    const resolved = await this.document.resolveValue(raw, signal);
    if (isPdfName(resolved, "None")) return SOFT_MASK_NONE;
    if (!isPdfDictionary(resolved)) {
      throw new PdfError("invalid-object", `${label} /SMask is neither /None nor a dictionary.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-invalid" }
      });
    }
    for (const key of resolved.keys()) {
      if (!SOFT_MASK_KEYS.has(key)) {
        throw extGStateError(`${label} /SMask contains unsupported entry /${key}.`, {
          reason: "soft-mask-entry-unsupported",
          entry: key
        });
      }
    }
    const type = await this.document.resolveValue(resolved.get("Type"), signal);
    if (type !== undefined && type !== null && !isPdfName(type, "Mask")) {
      throw new PdfError("invalid-object", `${label} /SMask /Type is not /Mask.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-marker-invalid" }
      });
    }
    const subtypeValue = await this.document.resolveValue(resolved.get("S"), signal);
    if (!isPdfName(subtypeValue) || (subtypeValue.value !== "Alpha" && subtypeValue.value !== "Luminosity")) {
      throw extGStateError(`${label} /SMask /S must be /Alpha or /Luminosity.`, {
        reason: "soft-mask-subtype-unsupported",
        subtype: isPdfName(subtypeValue) ? subtypeValue.value : null
      });
    }
    const rawForm = resolved.get("G");
    if (rawForm === undefined || rawForm === null) {
      throw new PdfError("invalid-object", `${label} /SMask is missing its /G Form.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-form-missing" }
      });
    }
    const form = await this.loadSoftMaskForm(
      rawForm,
      resources,
      { ...stack, depth: stack.depth + 1 },
      `${label} /SMask /G`,
      signal
    );
    if (subtypeValue.value === "Luminosity" && !form.handle.group.colorSpace) {
      throw extGStateError("A luminosity soft mask requires an explicit transparency-group color space.", {
        reason: "soft-mask-luminosity-color-space-missing"
      });
    }
    const backdropColor = await this.readBackdropColor(
      resolved,
      form.handle.group,
      label,
      signal
    );
    const transferFunctionIndex = await this.readSoftMaskTransfer(resolved, label, signal);
    return Object.freeze({
      kind: "mask",
      subtype: subtypeValue.value,
      formHandle: form.handle,
      backdropColor,
      transferFunctionIndex
    });
  }

  private async readBackdropColor(
    dictionary: PdfDictionary,
    group: Readonly<NativePdfSoftMaskGroupDescription>,
    label: string,
    signal?: AbortSignal
  ): Promise<readonly number[] | null> {
    if (!dictionary.has("BC")) return null;
    const raw = await this.document.resolveValue(dictionary.get("BC"), signal);
    if (!Array.isArray(raw)) {
      throw new PdfError("invalid-object", `${label} /SMask /BC is not an array.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-backdrop-invalid" }
      });
    }
    if (!group.colorSpace) {
      throw extGStateError("A soft-mask backdrop color requires an explicit group color space.", {
        reason: "soft-mask-backdrop-color-space-missing"
      });
    }
    if (raw.length !== group.colorSpace.componentCount) {
      throw new PdfError("invalid-object", "Soft-mask backdrop color arity does not match the group color space.", {
        details: {
          feature: "ext-gstate",
          reason: "soft-mask-backdrop-arity",
          expected: group.colorSpace.componentCount,
          actual: raw.length
        }
      });
    }
    const components: number[] = [];
    for (const entry of raw) {
      const value = await this.document.resolveValue(entry, signal);
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new PdfError("invalid-object", "Soft-mask backdrop color contains a non-finite component.", {
          details: { feature: "ext-gstate", reason: "soft-mask-backdrop-invalid" }
        });
      }
      components.push(value);
    }
    return Object.freeze(components);
  }

  private async readSoftMaskTransfer(
    dictionary: PdfDictionary,
    label: string,
    signal?: AbortSignal
  ): Promise<number> {
    if (!dictionary.has("TR")) return -1;
    const raw = dictionary.get("TR");
    if (raw === undefined || raw === null) {
      throw new PdfError("invalid-object", `${label} /SMask /TR is null.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-transfer-invalid" }
      });
    }
    const resolved = await this.document.resolveValue(raw, signal);
    if (isPdfName(resolved, "Identity")) return -1;
    if (isPdfName(resolved)) {
      throw extGStateError(`${label} /SMask has unsupported transfer /${resolved.value}.`, {
        reason: "soft-mask-transfer-unsupported",
        transfer: resolved.value
      });
    }
    const functionIndex = await this.functions.add(raw, signal);
    if (functionIndex > MAX_INT32) {
      throw new PdfError("resource-limit", "Soft-mask transfer function index exceeds the Int32 ABI.", {
        details: { feature: "ext-gstate", reason: "soft-mask-transfer-index" }
      });
    }
    const functionValue = this.functions.describe(functionIndex);
    if (functionValue.inputCount !== 1 || functionValue.outputCount !== 1) {
      throw extGStateError("A soft-mask transfer function must map one input to one output.", {
        reason: "soft-mask-transfer-arity",
        inputCount: functionValue.inputCount,
        outputCount: functionValue.outputCount
      });
    }
    return functionIndex;
  }

  private async loadSoftMaskForm(
    value: PdfValue,
    inheritedResources: PdfDictionary,
    stack: ResolutionStack,
    label: string,
    signal?: AbortSignal,
    sourceRef: PdfRef | null = null
  ): Promise<ParsedSoftMaskForm> {
    throwIfAborted(signal);
    this.checkDepth(stack);
    if (isPdfRef(value)) {
      const identity = pdfRefKey(value);
      if (stack.refs.has(identity)) {
        throw extGStateError("A soft-mask Form reference graph contains a cycle.", {
          reason: "soft-mask-form-cycle",
          objectNumber: value.objectNumber
        });
      }
      const key = `${identity}@${this.scopeId(inheritedResources)}`;
      const cached = this.softMaskRefCache.get(key);
      if (cached) return await cached;
      const refs = new Set(stack.refs);
      refs.add(identity);
      const pending = this.document.resolveObject(value, signal).then((resolved) =>
        this.loadSoftMaskForm(
          resolved,
          inheritedResources,
          { ...stack, refs, depth: stack.depth + 1 },
          label,
          signal,
          sourceRef ?? value
        )
      );
      this.softMaskRefCache.set(key, pending);
      try {
        return await pending;
      } catch (error) {
        this.softMaskRefCache.delete(key);
        throw error;
      }
    }
    if (!isPdfStream(value)) {
      throw new PdfError("invalid-object", `${label} is not a Form stream.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-form-invalid" }
      });
    }
    if (stack.objects.has(value)) {
      throw extGStateError("A direct soft-mask Form graph contains a cycle.", {
        reason: "soft-mask-form-cycle"
      });
    }
    const scope = this.scopeId(inheritedResources);
    let scopedCache = this.softMaskObjectCache.get(value);
    if (!scopedCache) {
      scopedCache = new Map();
      this.softMaskObjectCache.set(value, scopedCache);
    }
    const cached = scopedCache.get(scope);
    if (cached) return await cached;
    const pending = this.parseSoftMaskForm(
      value,
      inheritedResources,
      label,
      sourceRef,
      signal
    );
    scopedCache.set(scope, pending);
    try {
      return await pending;
    } catch (error) {
      scopedCache.delete(scope);
      throw error;
    }
  }

  private async parseSoftMaskForm(
    stream: PdfStream,
    inheritedResources: PdfDictionary,
    label: string,
    sourceRef: PdfRef | null,
    signal?: AbortSignal
  ): Promise<ParsedSoftMaskForm> {
    const dictionary = stream.dictionary;
    const type = await this.document.resolveValue(dictionary.get("Type"), signal);
    if (type !== undefined && type !== null && !isPdfName(type, "XObject")) {
      throw new PdfError("invalid-object", `${label} /Type is not /XObject.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-form-marker-invalid" }
      });
    }
    const subtype = await this.document.resolveValue(dictionary.get("Subtype"), signal);
    if (!isPdfName(subtype, "Form")) {
      throw new PdfError("invalid-object", `${label} /Subtype is not /Form.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-form-subtype-invalid" }
      });
    }
    const formType = await this.document.resolveValue(dictionary.get("FormType"), signal);
    if (formType !== undefined && formType !== null && formType !== 1) {
      throw extGStateError(`${label} has unsupported FormType ${String(formType)}.`, {
        reason: "soft-mask-form-type-unsupported"
      });
    }
    const bbox = normalizeRectangle(await requiredNumberArray(
      this.document,
      dictionary.get("BBox"),
      4,
      `${label} /BBox`,
      signal
    ));
    if (!(bbox[0] < bbox[2]) || !(bbox[1] < bbox[3])) {
      throw new PdfError("invalid-object", `${label} /BBox must have positive area.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-form-bbox-invalid" }
      });
    }
    const matrix = dictionary.has("Matrix")
      ? Object.freeze(await requiredNumberArray(
          this.document,
          dictionary.get("Matrix"),
          6,
          `${label} /Matrix`,
          signal
        )) as NativePdfMatrix
      : IDENTITY_MATRIX;
    const resources = await this.resolveFormResources(dictionary, inheritedResources, label, signal);
    const group = await this.readTransparencyGroup(dictionary.get("Group"), resources.dictionary, label, signal);
    if (stream.bytes.byteLength > MAX_UINT32) {
      throw new PdfError("resource-limit", `${label} encoded bytes exceed the Uint32 sidecar ABI.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-form-encoded-bytes" }
      });
    }
    const sourceIdentity = sourceRef
      ? `ref:${pdfRefKey(sourceRef)}`
      : `direct:${this.objectIdentity(stream)}`;
    const transparencyGroup: NativePdfTransparencyGroup = Object.freeze({
      subtype: "Transparency",
      isolated: group.isolated,
      knockout: group.knockout,
      colorSpace: group.rawColorSpace ?? undefined
    });
    const form: NativePdfForm = Object.freeze({
      id: `soft-mask:${sourceIdentity}|resources:${resources.identity}`,
      ref: sourceRef,
      dictionary,
      bbox: Object.freeze(bbox) as NativePdfRectangle,
      matrix,
      resources: resources.dictionary,
      resourceOrigin: resources.origin,
      group: transparencyGroup,
      encodedContentBytes: stream.bytes.byteLength
    });
    const handle: NativePdfSoftMaskFormHandle = Object.freeze({ form, group });
    this.streamByForm.set(form, stream);
    return Object.freeze({ handle, stream });
  }

  private async resolveFormResources(
    dictionary: PdfDictionary,
    inherited: PdfDictionary,
    label: string,
    signal?: AbortSignal
  ): Promise<EffectiveResourceScope> {
    if (dictionary.has("Resources")) {
      const raw = dictionary.get("Resources");
      if (raw === undefined || raw === null) {
        throw new PdfError("invalid-object", `${label} has a null /Resources entry.`, {
          details: { feature: "ext-gstate", reason: "soft-mask-form-resources-invalid" }
        });
      }
      return {
        dictionary: await this.document.resolveDictionary(raw, signal),
        origin: "local",
        identity: this.valueIdentity(raw)
      };
    }
    return {
      dictionary: inherited,
      origin: inherited === EMPTY_RESOURCES ? "empty" : "inherited",
      identity: inherited === EMPTY_RESOURCES ? "empty" : `direct:${this.objectIdentity(inherited)}`
    };
  }

  private async readTransparencyGroup(
    raw: PdfValue | undefined,
    resources: PdfDictionary,
    label: string,
    signal?: AbortSignal
  ): Promise<Readonly<NativePdfSoftMaskGroupDescription>> {
    const resolved = await this.document.resolveValue(raw, signal);
    if (!isPdfDictionary(resolved)) {
      throw new PdfError("invalid-object", `${label} has no transparency /Group dictionary.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-group-missing" }
      });
    }
    for (const key of resolved.keys()) {
      if (!TRANSPARENCY_GROUP_KEYS.has(key)) {
        throw extGStateError(`${label} /Group contains unsupported entry /${key}.`, {
          reason: "soft-mask-group-entry-unsupported",
          entry: key
        });
      }
    }
    const type = await this.document.resolveValue(resolved.get("Type"), signal);
    if (type !== undefined && type !== null && !isPdfName(type, "Group")) {
      throw new PdfError("invalid-object", `${label} /Group /Type is not /Group.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-group-marker-invalid" }
      });
    }
    const subtype = await this.document.resolveValue(resolved.get("S"), signal);
    if (!isPdfName(subtype, "Transparency")) {
      throw extGStateError(`${label} /Group /S is not /Transparency.`, {
        reason: "soft-mask-group-subtype-unsupported"
      });
    }
    const isolated = await optionalBoolean(this.document, resolved, "I", `${label} /Group`, signal) ?? false;
    const knockout = await optionalBoolean(this.document, resolved, "K", `${label} /Group`, signal) ?? false;
    const rawColorSpace = resolved.get("CS");
    if (rawColorSpace === undefined || rawColorSpace === null) {
      return Object.freeze({
        isolated,
        knockout,
        colorSpaceIndex: -1,
        colorSpace: null,
        rawColorSpace: null
      });
    }
    const outerColorSpace = await this.document.resolveValue(rawColorSpace, signal);
    if (!isPdfName(outerColorSpace) && !Array.isArray(outerColorSpace)) {
      throw new PdfError("invalid-object", `${label} /Group /CS is not a color-space name or array.`, {
        details: { feature: "ext-gstate", reason: "soft-mask-group-color-space-invalid" }
      });
    }
    const colorSpaceResources = resources.has("ColorSpace")
      ? await this.document.resolveDictionary(resources.get("ColorSpace"), signal)
      : undefined;
    const colorSpaceIndex = await this.colors.add(rawColorSpace, colorSpaceResources, signal);
    const colorSpace = this.colors.describe(colorSpaceIndex);
    if (!isTransparencyBlendingSpace(colorSpace)) {
      throw extGStateError(`${label} /Group uses an invalid transparency blending color space.`, {
        reason: "soft-mask-group-color-space-unsupported",
        colorSpace: colorSpace.kind
      });
    }
    return Object.freeze({
      isolated,
      knockout,
      colorSpaceIndex,
      colorSpace,
      rawColorSpace: outerColorSpace
    });
  }

  private getRecord(index: number): ExtGStateRecord {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.records.length) {
      throw new RangeError(`PDF ExtGState index ${index} is out of range.`);
    }
    return this.records[index];
  }

  private checkDepth(stack: ResolutionStack): void {
    if (stack.depth > this.maxDepth) {
      throw new PdfError("resource-limit", `ExtGState resolution exceeds depth ${this.maxDepth}.`, {
        details: {
          feature: "ext-gstate",
          reason: "extgstate-depth",
          maxExtGStateDepth: this.maxDepth
        }
      });
    }
  }

  private scopeId(resources: PdfDictionary | undefined): number {
    if (!resources || resources === EMPTY_RESOURCES) return 0;
    let id = this.scopeIds.get(resources);
    if (id === undefined) {
      id = this.nextScopeId++;
      this.scopeIds.set(resources, id);
    }
    return id;
  }

  private objectIdentity(value: object): number {
    let id = this.objectIds.get(value);
    if (id === undefined) {
      id = this.nextObjectId++;
      this.objectIds.set(value, id);
    }
    return id;
  }

  private valueIdentity(value: PdfValue): string {
    return isPdfRef(value) ? `ref:${pdfRefKey(value)}` : `direct:${this.objectIdentity(value as object)}`;
  }
}

function emptyStack(): ResolutionStack {
  return { refs: new Set(), objects: new Set(), resourceNames: new Set(), depth: 0 };
}

function normalizeName(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function normalizeBlendMode(value: NativePdfBlendModeName): PdfBlendMode {
  return value === "Compatible" ? "Normal" : value;
}

function groupTemplate(
  alpha: number,
  alphaIsShape: boolean,
  blendMode: PdfBlendMode
): HeprCompositeGroup {
  return Object.freeze({
    commands: Object.freeze([]),
    isolated: false,
    knockout: false,
    blendMode,
    alpha,
    alphaIsShape,
    softMaskGroupIndex: -1,
    softMaskSubtype: null,
    softMaskTransferFunctionIndex: -1,
    backdropPaintIndex: -1,
    blendingColorSpaceIndex: -1,
    clipIndex: -1
  });
}

function isTransparencyBlendingSpace(
  value: Readonly<NativePdfColorSpaceDescription>
): boolean {
  return value.kind === "DeviceGray" || value.kind === "DeviceRGB" || value.kind === "DeviceCMYK" ||
    value.kind === "CalGray" || value.kind === "CalRGB" || value.kind === "Lab" ||
    value.kind === "ICCBased";
}

function validateLineStyleInteger(value: number | null, label: string, key: string): number | null {
  if (value !== null && value !== 0 && value !== 1 && value !== 2) {
    throw invalidEntry(label, key, "must be 0, 1, or 2", "extgstate-line-style-invalid");
  }
  return value;
}

async function optionalBoolean(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  label: string,
  signal?: AbortSignal
): Promise<boolean | null> {
  if (!dictionary.has(key)) return null;
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (typeof value !== "boolean") {
    throw invalidEntry(label, key, "must be a boolean", "extgstate-boolean-invalid");
  }
  return value;
}

async function optionalInteger(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  label: string,
  signal?: AbortSignal
): Promise<number | null> {
  if (!dictionary.has(key)) return null;
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw invalidEntry(label, key, "must be an integer", "extgstate-integer-invalid");
  }
  return value;
}

async function optionalBoundedNumber(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  minimum: number,
  maximum: number,
  label: string,
  signal?: AbortSignal
): Promise<number | null> {
  if (!dictionary.has(key)) return null;
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidEntry(
      label,
      key,
      `must be a finite number from ${minimum} through ${maximum}`,
      "extgstate-number-invalid"
    );
  }
  return value;
}

async function optionalMinimumNumber(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  minimum: number,
  label: string,
  signal?: AbortSignal
): Promise<number | null> {
  if (!dictionary.has(key)) return null;
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw invalidEntry(
      label,
      key,
      `must be a finite number greater than or equal to ${minimum}`,
      "extgstate-number-invalid"
    );
  }
  return value;
}

async function requiredNumberArray(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  count: number,
  label: string,
  signal?: AbortSignal
): Promise<number[]> {
  const resolved = await document.resolveValue(value, signal);
  if (!Array.isArray(resolved) || resolved.length !== count) {
    throw new PdfError("invalid-object", `${label} is not a ${count}-number array.`, {
      details: { feature: "ext-gstate" }
    });
  }
  const result: number[] = [];
  for (const raw of resolved) {
    const entry = await document.resolveValue(raw, signal);
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new PdfError("invalid-object", `${label} contains a non-finite number.`, {
        details: { feature: "ext-gstate" }
      });
    }
    result.push(entry);
  }
  return result;
}

function normalizeRectangle(values: readonly number[]): NativePdfRectangle {
  return [
    Math.min(values[0], values[2]),
    Math.min(values[1], values[3]),
    Math.max(values[0], values[2]),
    Math.max(values[1], values[3])
  ];
}

function boundedOption(value: number | undefined, maximum: number, name: string): number {
  const configured = value ?? maximum;
  if (!Number.isSafeInteger(configured) || configured <= 0 || configured > maximum) {
    throw new RangeError(`${name} must be a positive safe integer no greater than ${maximum}.`);
  }
  return configured;
}

function invalidEntry(label: string, key: string, suffix: string, reason: string): PdfError {
  return new PdfError("invalid-object", `${label} /${key} ${suffix}.`, {
    details: { feature: "ext-gstate", reason, entry: key }
  });
}

function extGStateError(
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>
): PdfError {
  return new PdfError("unsupported-content", message, {
    details: { feature: "ext-gstate", ...details }
  });
}

function formatPdfValue(value: PdfValue | undefined): string {
  if (isPdfName(value)) return `/${value.value}`;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (isPdfDictionary(value)) return "a dictionary";
  if (isPdfStream(value)) return "a stream";
  return JSON.stringify(value);
}
