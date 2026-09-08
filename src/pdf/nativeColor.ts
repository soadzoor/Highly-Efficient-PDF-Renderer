import {
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  isPdfString,
  pdfRefKey,
  type PdfDictionary,
  type PdfName,
  type PdfValue
} from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import {
  NativePdfFunctionRegistry,
  type NativePdfFunctionLimits
} from "./nativeFunctions";
import { PdfError, throwIfAborted } from "./nativeTypes";
import {
  DEFAULT_MAX_ICC_TRANSFORM_BYTES,
  createNativeIccTransformRequest,
  resolveNativeIccTransformThroughCaller,
  sampleNativeIccTransform,
  type NativeIccComponentCount,
  type NativeIccProfileMetadata,
  type NativeIccTransformKernel,
  type NativeIccTransformResolver,
  type NativeIccTransformResult
} from "./nativeIcc";
import {
  HEPR_COLOR_SPACE_KIND,
  type HeprColorStore
} from "../heprDocumentData";
import { convertDeviceCmykToSrgb } from "./deviceCmyk";

export type NativePdfColorSpaceKind =
  | "DeviceGray"
  | "DeviceRGB"
  | "DeviceCMYK"
  | "CalGray"
  | "CalRGB"
  | "Lab"
  | "ICCBased"
  | "Indexed"
  | "Separation"
  | "DeviceN";

export type {
  NativeIccProfileMetadata,
  NativeIccTransformKernel,
  NativeIccTransformRequest,
  NativeIccTransformResolver,
  NativeIccTransformResult
} from "./nativeIcc";

export interface NativePdfColorOptions {
  readonly functionLimits?: Partial<NativePdfFunctionLimits>;
  readonly iccKernel?: NativeIccTransformKernel;
  readonly iccTransformResolver?: NativeIccTransformResolver;
  readonly maxIccProfileBytes?: number;
  readonly maxIccTransformBytes?: number;
  readonly maxDeviceNComponents?: number;
  readonly maxColorSpaces?: number;
  readonly maxColorDepth?: number;
  readonly maxStoreValues?: number;
  readonly maxStoreBytes?: number;
}

export interface NativePdfColorSpaceDescription {
  readonly kind: NativePdfColorSpaceKind;
  readonly componentCount: number;
  readonly alternateSpaceIndex: number;
  readonly functionIndex: number;
  readonly parameters: readonly number[];
  readonly names: readonly string[];
  readonly profile: Uint8Array;
  readonly lookup: Uint8Array;
  readonly iccMetadata: Readonly<NativeIccProfileMetadata> | null;
}

interface ColorRecord extends NativePdfColorSpaceDescription {
  readonly highValue: number;
  readonly iccTransform: Readonly<NativeIccTransformResult> | null;
}

interface ColorParseStack {
  readonly refs: ReadonlySet<string>;
  readonly objects: ReadonlySet<object>;
  readonly resourceNames: ReadonlySet<string>;
  readonly depth: number;
}

const DEFAULT_MAX_ICC_PROFILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_DEVICE_N_COMPONENTS = 32;
const DEFAULT_MAX_COLOR_SPACES = 4_096;
const DEFAULT_MAX_COLOR_STORE_VALUES = 16_777_216;
const DEFAULT_MAX_COLOR_STORE_BYTES = 128 * 1024 * 1024;
const D65 = [0.95047, 1, 1.08883] as const;

/** Owns PDF color resources and their canonical-sRGB conversion. */
export class NativePdfColorRegistry {
  readonly functions: NativePdfFunctionRegistry;

  private readonly document: NativePdfDocument;
  private readonly iccKernel?: NativeIccTransformKernel;
  private readonly iccTransformResolver?: NativeIccTransformResolver;
  private readonly maxIccProfileBytes: number;
  private readonly maxIccTransformBytes: number;
  private readonly maxDeviceNComponents: number;
  private readonly maxColorSpaces: number;
  private readonly maxColorDepth: number;
  private readonly maxStoreValues: number;
  private readonly maxStoreBytes: number;
  private readonly records: ColorRecord[] = [];
  private readonly refCache = new Map<string, Promise<number>>();
  private readonly objectCache = new WeakMap<object, Map<number, Promise<number>>>();
  private readonly deviceCache = new Map<string, number>();
  private readonly resourceCache = new WeakMap<PdfDictionary, Map<string, Promise<number>>>();
  private readonly scopeIds = new WeakMap<PdfDictionary, number>();
  private nextScopeId = 1;
  private parameterValueCount = 0;
  private nameValueCount = 0;
  private storedByteCount = 0;

  constructor(
    document: NativePdfDocument,
    functions?: NativePdfFunctionRegistry,
    options: NativePdfColorOptions = {}
  ) {
    this.document = document;
    this.functions = functions ?? new NativePdfFunctionRegistry(document, options.functionLimits);
    this.iccKernel = options.iccKernel;
    this.iccTransformResolver = options.iccTransformResolver;
    this.maxIccProfileBytes = positiveLimit(
      options.maxIccProfileBytes ?? document.limits.maxIccProfileBytes ?? DEFAULT_MAX_ICC_PROFILE_BYTES,
      "maxIccProfileBytes"
    );
    this.maxIccTransformBytes = positiveLimit(
      options.maxIccTransformBytes ??
        document.limits.maxIccTransformBytes ??
        DEFAULT_MAX_ICC_TRANSFORM_BYTES,
      "maxIccTransformBytes"
    );
    this.maxDeviceNComponents = boundedLimit(
      options.maxDeviceNComponents ?? DEFAULT_MAX_DEVICE_N_COMPONENTS,
      255,
      "maxDeviceNComponents"
    );
    this.maxColorSpaces = boundedLimit(
      options.maxColorSpaces ?? DEFAULT_MAX_COLOR_SPACES,
      0x7fff_ffff,
      "maxColorSpaces"
    );
    this.maxColorDepth = boundedLimit(
      options.maxColorDepth ?? document.limits.maxRecursionDepth,
      document.limits.maxRecursionDepth,
      "maxColorDepth"
    );
    this.maxStoreValues = boundedLimit(
      options.maxStoreValues ?? DEFAULT_MAX_COLOR_STORE_VALUES,
      0xffff_ffff,
      "maxStoreValues"
    );
    this.maxStoreBytes = boundedLimit(
      options.maxStoreBytes ?? DEFAULT_MAX_COLOR_STORE_BYTES,
      0xffff_ffff,
      "maxStoreBytes"
    );
  }

  get size(): number {
    return this.records.length;
  }

  async add(
    value: PdfValue,
    colorSpaceResources?: PdfDictionary,
    signal?: AbortSignal
  ): Promise<number> {
    return await this.addInternal(
      value,
      colorSpaceResources,
      { refs: new Set(), objects: new Set(), resourceNames: new Set(), depth: 0 },
      signal
    );
  }

  /**
   * Resolve `/Pattern` or `[/Pattern base]` without inventing a Pattern entry in
   * the color store. A `null` result denotes a colored pattern; an integer is
   * the managed base-space index for an uncolored tiling pattern.
   */
  async resolvePatternBase(
    value: PdfValue,
    colorSpaceResources?: PdfDictionary,
    signal?: AbortSignal
  ): Promise<number | null> {
    return await this.resolvePatternBaseInternal(
      value,
      colorSpaceResources,
      { refs: new Set(), objects: new Set(), resourceNames: new Set(), depth: 0 },
      signal
    );
  }

  describe(index: number): Readonly<NativePdfColorSpaceDescription> {
    return this.getRecord(index);
  }

  /** Default image Decode array for this color space. */
  defaultDecode(index: number): readonly number[] {
    const record = this.getRecord(index);
    if (record.kind === "Indexed") return [0, record.highValue];
    if (record.kind === "Lab") {
      return [0, 100, record.parameters[6], record.parameters[7], record.parameters[8], record.parameters[9]];
    }
    if (record.kind === "ICCBased" && record.parameters.length === record.componentCount * 2) {
      return record.parameters;
    }
    return Array.from({ length: record.componentCount }, () => [0, 1]).flat();
  }

  /** Convert one color to canonical nonlinear sRGB in the closed interval [0, 1]. */
  convertToSrgb(
    index: number,
    components: readonly number[],
    signal?: AbortSignal
  ): readonly [number, number, number] {
    throwIfAborted(signal);
    const record = this.getRecord(index);
    // Resolved device spaces are leaves, including aliases whose default
    // replacement was resolved in addName(). Image pixels need no traversal
    // set, mapped component array, or second copy of the resulting RGB tuple.
    if (record.kind === "DeviceGray" || record.kind === "DeviceRGB" || record.kind === "DeviceCMYK") {
      if (components.length !== record.componentCount) {
        throw new PdfError("unsupported-color", `${record.kind} received an invalid component vector.`);
      }
      for (let component = 0; component < components.length; component += 1) {
        if (!Number.isFinite(components[component])) {
          throw new PdfError("unsupported-color", `${record.kind} received an invalid component vector.`);
        }
      }
      if (record.kind === "DeviceGray") {
        const gray = clamp01(components[0]);
        return [gray, gray, gray];
      }
      if (record.kind === "DeviceRGB") {
        return [clamp01(components[0]), clamp01(components[1]), clamp01(components[2])];
      }
      return convertDeviceCmykToSrgb(components[0], components[1], components[2], components[3]);
    }
    return this.convertInternal(index, components, new Set(), 0, signal);
  }

  /**
   * HEPR color-store ABI (all offset arrays have `spaceCount + 1` entries):
   *
   * - CalGray parameters: WhitePoint[3], BlackPoint[3], Gamma.
   * - CalRGB parameters: WhitePoint[3], BlackPoint[3], Gamma[3], Matrix[9]
   *   in PDF's XA/YA/ZA, XB/YB/ZB, XC/YC/ZC order.
   * - Lab parameters: WhitePoint[3], BlackPoint[3], Range[4].
   * - ICCBased parameters: component Range pairs; `profiles` contains the
   *   declared ICC payload (never trailing stream bytes).
   * - Indexed parameters: hival; `lookupBytes` is exactly
   *   `(hival + 1) * baseComponentCount` bytes.
   * - Separation/DeviceN names: colorants in source component order.
   *
   * Alternate/function indices are -1 when the family has no such resource.
   * Pattern spaces are represented by the pattern store and use
   * resolvePatternBase(), so no lossy pseudo-color entry is emitted here.
   */
  buildStore(signal?: AbortSignal): HeprColorStore {
    throwIfAborted(signal);
    let profileValueCount = 0;
    let lookupValueCount = 0;
    for (let index = 0; index < this.records.length; index += 1) {
      if ((index & 0x3fff) === 0) throwIfAborted(signal);
      const record = this.records[index];
      profileValueCount = checkedStoreLength(
        profileValueCount,
        record.profile.length,
        this.maxStoreBytes,
        "profile"
      );
      lookupValueCount = checkedStoreLength(
        lookupValueCount,
        record.lookup.length,
        this.maxStoreBytes,
        "lookup"
      );
    }

    // Allocate final typed stores once. Building large ICC stores through
    // number[] intermediates multiplies peak memory and can overflow the JS
    // argument stack, so all payloads are copied directly into their ABI view.
    const componentCounts = allocateStore(
      () => new Uint8Array(this.records.length),
      "color component-count store"
    );
    const alternateSpaceIndices = allocateStore(
      () => new Int32Array(this.records.length),
      "color alternate-index store"
    );
    const functionIndices = allocateStore(
      () => new Int32Array(this.records.length),
      "color function-index store"
    );
    const spaceKinds = allocateStore(
      () => new Uint8Array(this.records.length),
      "color kind store"
    );
    const parameterOffsets = allocateStore(
      () => new Uint32Array(this.records.length + 1),
      "color parameter-offset store"
    );
    const nameOffsets = allocateStore(
      () => new Uint32Array(this.records.length + 1),
      "color name-offset store"
    );
    const profileOffsets = allocateStore(
      () => new Uint32Array(this.records.length + 1),
      "color profile-offset store"
    );
    const lookupOffsets = allocateStore(
      () => new Uint32Array(this.records.length + 1),
      "color lookup-offset store"
    );
    const parameters = allocateStore(
      () => new Float32Array(this.parameterValueCount),
      "color parameter store"
    );
    const names = allocateStore(
      () => new Array<string>(this.nameValueCount),
      "color name store"
    );
    const profiles = allocateStore(
      () => new Uint8Array(profileValueCount),
      "ICC profile store"
    );
    const lookupBytes = allocateStore(
      () => new Uint8Array(lookupValueCount),
      "Indexed lookup store"
    );

    let parameterOffset = 0;
    let nameOffset = 0;
    let profileOffset = 0;
    let lookupOffset = 0;
    for (let index = 0; index < this.records.length; index += 1) {
      throwIfAborted(signal);
      const record = this.records[index];
      componentCounts[index] = record.componentCount;
      alternateSpaceIndices[index] = record.alternateSpaceIndex;
      functionIndices[index] = record.functionIndex;
      spaceKinds[index] = heprColorKind(record.kind);
      parameterOffset = copyFloatValues(parameters, parameterOffset, record.parameters, signal);
      nameOffset = copyStringValues(names, nameOffset, record.names, signal);
      profileOffset = copyByteValues(profiles, profileOffset, record.profile, signal);
      lookupOffset = copyByteValues(lookupBytes, lookupOffset, record.lookup, signal);
      parameterOffsets[index + 1] = parameterOffset;
      nameOffsets[index + 1] = nameOffset;
      profileOffsets[index + 1] = profileOffset;
      lookupOffsets[index + 1] = lookupOffset;
    }
    return {
      spaceKinds,
      componentCounts,
      alternateSpaceIndices,
      functionIndices,
      parameterOffsets,
      parameters,
      nameOffsets,
      names,
      profileOffsets,
      profiles,
      lookupOffsets,
      lookupBytes
    };
  }

  private async addInternal(
    value: PdfValue,
    resources: PdfDictionary | undefined,
    stack: ColorParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    if (stack.depth >= this.maxColorDepth) {
      throw new PdfError("resource-limit", "PDF color-space nesting exceeds its configured limit.");
    }
    if (isPdfRef(value)) {
      const identity = pdfRefKey(value);
      if (stack.refs.has(identity)) {
        throw new PdfError("unsupported-color", "A PDF color-space graph contains a cycle.", {
          objectNumber: value.objectNumber
        });
      }
      const key = `${identity}@${this.scopeId(resources)}`;
      const cached = this.refCache.get(key);
      if (cached) return await cached;
      const refs = new Set(stack.refs);
      refs.add(identity);
      const promise = this.document.resolveObject(value, signal)
        .then((resolved) => this.addInternal(
          resolved,
          resources,
          { ...stack, refs, depth: stack.depth + 1 },
          signal
        ));
      this.refCache.set(key, promise);
      try {
        return await promise;
      } catch (error) {
        this.refCache.delete(key);
        throw error;
      }
    }
    if (isPdfName(value)) return await this.addName(value, resources, stack, signal);
    if (!Array.isArray(value)) {
      throw new PdfError("unsupported-color", "A PDF color space is not a name or array.");
    }
    if (stack.objects.has(value)) {
      throw new PdfError("unsupported-color", "A direct PDF color-space graph contains a cycle.");
    }
    const scopeId = this.scopeId(resources);
    let scopedCache = this.objectCache.get(value);
    if (!scopedCache) {
      scopedCache = new Map();
      this.objectCache.set(value, scopedCache);
    }
    const cached = scopedCache.get(scopeId);
    if (cached) return await cached;
    const objects = new Set(stack.objects);
    objects.add(value);
    const promise = this.parseAndAppend(
      value,
      resources,
      { ...stack, objects, depth: stack.depth + 1 },
      signal
    );
    scopedCache.set(scopeId, promise);
    try {
      return await promise;
    } catch (error) {
      scopedCache.delete(scopeId);
      throw error;
    }
  }

  private scopeId(resources: PdfDictionary | undefined): number {
    if (!resources) return 0;
    const existing = this.scopeIds.get(resources);
    if (existing !== undefined) return existing;
    const next = this.nextScopeId++;
    this.scopeIds.set(resources, next);
    return next;
  }

  private async resolvePatternBaseInternal(
    value: PdfValue,
    resources: PdfDictionary | undefined,
    stack: ColorParseStack,
    signal?: AbortSignal
  ): Promise<number | null> {
    throwIfAborted(signal);
    if (stack.depth >= this.maxColorDepth) {
      throw new PdfError("resource-limit", "Pattern color-space aliases exceed the color recursion limit.");
    }
    if (isPdfRef(value)) {
      const identity = pdfRefKey(value);
      if (stack.refs.has(identity)) {
        throw new PdfError("unsupported-color", "A Pattern color-space graph contains a cycle.", {
          objectNumber: value.objectNumber
        });
      }
      const refs = new Set(stack.refs);
      refs.add(identity);
      const resolved = await this.document.resolveObject(value, signal);
      return await this.resolvePatternBaseInternal(
        resolved,
        resources,
        { ...stack, refs, depth: stack.depth + 1 },
        signal
      );
    }
    if (isPdfName(value)) {
      if (value.value === "Pattern") return null;
      if (!resources || !resources.has(value.value)) {
        throw new PdfError("unsupported-color", `Unknown Pattern color space /${value.value}.`);
      }
      const key = `${this.scopeId(resources)}:${value.value}`;
      if (stack.resourceNames.has(key)) {
        throw new PdfError("unsupported-color", `Pattern color-space resource /${value.value} is recursive.`);
      }
      const resourceNames = new Set(stack.resourceNames);
      resourceNames.add(key);
      return await this.resolvePatternBaseInternal(
        resources.get(value.value)!,
        resources,
        { ...stack, resourceNames, depth: stack.depth + 1 },
        signal
      );
    }
    if (!Array.isArray(value) || !isPdfName(value[0], "Pattern")) {
      throw new PdfError("unsupported-color", "A Pattern color space is malformed.");
    }
    if (value.length === 1) return null;
    if (value.length !== 2) {
      throw new PdfError("unsupported-color", "A Pattern color space has invalid arity.");
    }
    if (isPatternColorSpaceValue(value[1])) {
      throw new PdfError("unsupported-color", "A Pattern base color space cannot itself be Pattern.");
    }
    return await this.addInternal(value[1], resources, stack, signal);
  }

  private async assertDeclaredUnderlyingSpace(
    value: PdfValue,
    resources: PdfDictionary | undefined,
    stack: ColorParseStack,
    label: string,
    allowSeparationOrDeviceN: boolean,
    signal?: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal);
    if (stack.depth >= this.maxColorDepth) {
      throw new PdfError("resource-limit", `${label} aliases exceed the color recursion limit.`);
    }
    if (isPdfRef(value)) {
      const identity = pdfRefKey(value);
      if (stack.refs.has(identity)) throw new PdfError("unsupported-color", `${label} is recursive.`);
      const refs = new Set(stack.refs);
      refs.add(identity);
      const resolved = await this.document.resolveObject(value, signal);
      return await this.assertDeclaredUnderlyingSpace(
        resolved,
        resources,
        { ...stack, refs, depth: stack.depth + 1 },
        label,
        allowSeparationOrDeviceN,
        signal
      );
    }
    if (isPdfName(value)) {
      if (normalizeDeviceName(value.value)) return;
      const raw = resources?.get(value.value);
      if (raw === undefined) {
        throw new PdfError("unsupported-color", `${label} names an unavailable or prohibited color space.`);
      }
      const key = `${this.scopeId(resources)}:${value.value}`;
      if (stack.resourceNames.has(key)) throw new PdfError("unsupported-color", `${label} is recursive.`);
      const resourceNames = new Set(stack.resourceNames);
      resourceNames.add(key);
      return await this.assertDeclaredUnderlyingSpace(
        raw,
        resources,
        { ...stack, resourceNames, depth: stack.depth + 1 },
        label,
        allowSeparationOrDeviceN,
        signal
      );
    }
    if (Array.isArray(value) && isPdfName(value[0])) {
      const family = normalizeColorFamily(value[0].value);
      if (
        family === "CalGray"
        || family === "CalRGB"
        || family === "Lab"
        || family === "ICCBased"
        || (allowSeparationOrDeviceN && (family === "Separation" || family === "DeviceN"))
      ) {
        return;
      }
    }
    throw new PdfError("unsupported-color", `${label} has a prohibited color-space family.`);
  }

  private async addName(
    name: PdfName,
    resources: PdfDictionary | undefined,
    stack: ColorParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    const normalized = normalizeDeviceName(name.value);
    const defaultName = normalized === "DeviceGray"
      ? "DefaultGray"
      : normalized === "DeviceRGB"
        ? "DefaultRGB"
        : normalized === "DeviceCMYK"
          ? "DefaultCMYK"
          : null;
    if (defaultName && resources?.has(defaultName)) {
      const index = await this.addResourceName(defaultName, resources, stack, signal);
      const replacement = this.getRecord(index);
      const expectedComponents = normalized === "DeviceGray" ? 1 : normalized === "DeviceRGB" ? 3 : 4;
      if (
        replacement.componentCount !== expectedComponents
        || replacement.kind === "Lab"
        || replacement.kind === "Indexed"
      ) {
        throw new PdfError(
          "unsupported-color",
          `/${defaultName} is not compatible with /${normalized}.`,
          { details: { defaultName, replacementKind: replacement.kind } }
        );
      }
      return index;
    }
    if (normalized) {
      const cached = this.deviceCache.get(normalized);
      if (cached !== undefined) return cached;
      const index = this.append({
        kind: normalized,
        componentCount: normalized === "DeviceGray" ? 1 : normalized === "DeviceRGB" ? 3 : 4,
        alternateSpaceIndex: -1,
        functionIndex: -1,
        parameters: [],
        names: [],
        profile: new Uint8Array(0),
        lookup: new Uint8Array(0),
        iccMetadata: null,
        iccTransform: null,
        highValue: -1
      });
      this.deviceCache.set(normalized, index);
      return index;
    }
    if (name.value === "Pattern") {
      throw new PdfError(
        "unsupported-color",
        "Pattern color spaces must be resolved through resolvePatternBase()."
      );
    }
    if (!resources?.has(name.value)) {
      throw new PdfError("unsupported-color", `Unknown PDF color space /${name.value}.`, {
        details: { colorSpace: name.value }
      });
    }
    return await this.addResourceName(name.value, resources, stack, signal);
  }

  private async addResourceName(
    name: string,
    resources: PdfDictionary,
    stack: ColorParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    const key = `${this.scopeId(resources)}:${name}`;
    if (stack.resourceNames.has(key)) {
      throw new PdfError("unsupported-color", `Color-space resource /${name} is recursive.`);
    }
    let cache = this.resourceCache.get(resources);
    if (!cache) {
      cache = new Map();
      this.resourceCache.set(resources, cache);
    }
    const cached = cache.get(name);
    if (cached) return await cached;
    const resourceNames = new Set(stack.resourceNames);
    resourceNames.add(key);
    const raw = resources.get(name);
    if (raw === undefined) throw new PdfError("unsupported-color", `Missing color-space resource /${name}.`);
    const promise = this.addInternal(
      raw,
      resources,
      { ...stack, resourceNames, depth: stack.depth + 1 },
      signal
    );
    cache.set(name, promise);
    try {
      return await promise;
    } catch (error) {
      cache.delete(name);
      throw error;
    }
  }

  private async parseAndAppend(
    value: PdfValue,
    resources: PdfDictionary | undefined,
    stack: ColorParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    if (!Array.isArray(value) || value.length < 2 || !isPdfName(value[0])) {
      throw new PdfError("unsupported-color", "A PDF color-space array is malformed.");
    }
    const family = normalizeColorFamily(value[0].value);
    switch (family) {
      case "CalGray":
        requireColorArrayArity(value, 2, family);
        return this.append(await this.parseCalGray(value[1], signal));
      case "CalRGB":
        requireColorArrayArity(value, 2, family);
        return this.append(await this.parseCalRgb(value[1], signal));
      case "Lab":
        requireColorArrayArity(value, 2, family);
        return this.append(await this.parseLab(value[1], signal));
      case "ICCBased":
        requireColorArrayArity(value, 2, family);
        return this.append(await this.parseIcc(value[1], stack, signal));
      case "Indexed":
        return this.append(await this.parseIndexed(value, resources, stack, signal));
      case "Separation":
        return this.append(await this.parseSeparation(value, resources, stack, signal));
      case "DeviceN":
        return this.append(await this.parseDeviceN(value, resources, stack, signal));
      case "Pattern":
        throw new PdfError(
          "unsupported-color",
          "Pattern color spaces must be resolved through resolvePatternBase()."
        );
      default:
        throw new PdfError("unsupported-color", `Unsupported PDF color-space family /${value[0].value}.`, {
          details: { colorSpace: value[0].value }
        });
    }
  }

  private async parseCalGray(value: PdfValue, signal?: AbortSignal): Promise<ColorRecord> {
    const dictionary = await this.resolveDictionary(value, signal);
    const whitePoint = await requiredNumbers(this.document, dictionary, "WhitePoint", 3, signal);
    validateWhitePoint(whitePoint);
    const blackPoint = await optionalNumbers(this.document, dictionary, "BlackPoint", [0, 0, 0], signal);
    validateNonnegativeTriple(blackPoint, "CalGray BlackPoint");
    const gamma = await optionalNumber(this.document, dictionary, "Gamma", 1, signal);
    if (!(gamma > 0)) throw new PdfError("unsupported-color", "CalGray Gamma must be positive.");
    return colorRecord("CalGray", 1, [ ...whitePoint, ...blackPoint, gamma ]);
  }

  private async parseCalRgb(value: PdfValue, signal?: AbortSignal): Promise<ColorRecord> {
    const dictionary = await this.resolveDictionary(value, signal);
    const whitePoint = await requiredNumbers(this.document, dictionary, "WhitePoint", 3, signal);
    validateWhitePoint(whitePoint);
    const blackPoint = await optionalNumbers(this.document, dictionary, "BlackPoint", [0, 0, 0], signal);
    validateNonnegativeTriple(blackPoint, "CalRGB BlackPoint");
    const gamma = await optionalNumbers(this.document, dictionary, "Gamma", [1, 1, 1], signal);
    if (gamma.length !== 3 || gamma.some((entry) => !(entry > 0))) {
      throw new PdfError("unsupported-color", "CalRGB Gamma must contain three positive values.");
    }
    const matrix = await optionalNumbers(
      this.document,
      dictionary,
      "Matrix",
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
      signal
    );
    if (matrix.length !== 9) throw new PdfError("unsupported-color", "CalRGB Matrix must have nine values.");
    return colorRecord("CalRGB", 3, [...whitePoint, ...blackPoint, ...gamma, ...matrix]);
  }

  private async parseLab(value: PdfValue, signal?: AbortSignal): Promise<ColorRecord> {
    const dictionary = await this.resolveDictionary(value, signal);
    const whitePoint = await requiredNumbers(this.document, dictionary, "WhitePoint", 3, signal);
    validateWhitePoint(whitePoint);
    const blackPoint = await optionalNumbers(this.document, dictionary, "BlackPoint", [0, 0, 0], signal);
    validateNonnegativeTriple(blackPoint, "Lab BlackPoint");
    const range = await optionalNumbers(this.document, dictionary, "Range", [-100, 100, -100, 100], signal);
    if (range.length !== 4 || range[0] > range[1] || range[2] > range[3]) {
      throw new PdfError("unsupported-color", "Lab Range is invalid.");
    }
    return colorRecord("Lab", 3, [...whitePoint, ...blackPoint, ...range]);
  }

  private async parseIcc(
    value: PdfValue,
    stack: ColorParseStack,
    signal?: AbortSignal
  ): Promise<ColorRecord> {
    const resolved = await this.document.resolveValue(value, signal);
    if (!isPdfStream(resolved)) throw new PdfError("unsupported-color", "ICCBased color space lacks a profile stream.");
    const count = await requiredInteger(this.document, resolved.dictionary, "N", signal);
    if (![1, 3, 4].includes(count)) {
      throw new PdfError("unsupported-color", `Unsupported ICC component count ${count}.`);
    }
    const alternateRaw = resolved.dictionary.get("Alternate") ?? {
      kind: "name" as const,
      value: count === 1 ? "DeviceGray" : count === 3 ? "DeviceRGB" : "DeviceCMYK"
    };
    // ICC /Alternate is an explicit nested color space. Unlike Indexed bases
    // and Separation/DeviceN alternates, ISO 32000 does not subject it to the
    // current resource dictionary's DefaultGray/RGB/CMYK substitution.
    const alternateSpaceIndex = await this.addInternal(alternateRaw, undefined, stack, signal);
    const alternate = this.getRecord(alternateSpaceIndex);
    if (alternate.componentCount !== count) {
      throw new PdfError("unsupported-color", "An ICC Alternate color space has the wrong component count.");
    }
    const range = resolved.dictionary.has("Range")
      ? await requiredNumbers(this.document, resolved.dictionary, "Range", count * 2, signal)
      : Array.from({ length: count }, () => [0, 1]).flat();
    validateIntervals(range, "ICC Range");
    const decodedProfile = await this.document.decodeStream(resolved, signal);
    if (decodedProfile.length > this.maxIccProfileBytes) {
      throw new PdfError("resource-limit", "An ICC profile exceeds the configured byte limit.", {
        details: { byteLength: decodedProfile.length, limit: this.maxIccProfileBytes }
      });
    }
    const iccMetadata = parseIccMetadata(decodedProfile);
    validatePdfIccMetadata(iccMetadata, count);
    const profile = decodedProfile.slice(0, iccMetadata.declaredSize);
    const iccTransform = this.iccTransformResolver
      ? await resolveNativeIccTransformThroughCaller(
          this.iccTransformResolver,
          createNativeIccTransformRequest(
            profile,
            iccMetadata,
            count as NativeIccComponentCount,
            this.maxIccTransformBytes,
            signal
          ),
          this.maxIccTransformBytes,
          signal
        )
      : null;
    return {
      ...colorRecord("ICCBased", count, range),
      alternateSpaceIndex,
      profile,
      iccMetadata,
      iccTransform
    };
  }

  private async parseIndexed(
    values: readonly PdfValue[],
    resources: PdfDictionary | undefined,
    stack: ColorParseStack,
    signal?: AbortSignal
  ): Promise<ColorRecord> {
    if (values.length !== 4) throw new PdfError("unsupported-color", "Indexed color-space array has invalid arity.");
    // Since PDF 1.3, an Indexed base may also be Separation or DeviceN. It
    // still may not be Pattern or another Indexed space.
    await this.assertDeclaredUnderlyingSpace(
      values[1],
      resources,
      stack,
      "Indexed base",
      true,
      signal
    );
    const alternateSpaceIndex = await this.addInternal(values[1], resources, stack, signal);
    const base = this.getRecord(alternateSpaceIndex);
    const highValueRaw = await this.document.resolveValue(values[2], signal);
    if (
      typeof highValueRaw !== "number" ||
      !Number.isSafeInteger(highValueRaw) ||
      highValueRaw < 0 ||
      highValueRaw > 255
    ) {
      throw new PdfError("unsupported-color", "Indexed color-space hival must be from 0 through 255.");
    }
    const lookupValue = await this.document.resolveValue(values[3], signal);
    const lookup = isPdfString(lookupValue)
      ? lookupValue.bytes
      : isPdfStream(lookupValue)
        ? await this.document.decodeStream(lookupValue, signal)
        : null;
    if (!lookup) throw new PdfError("unsupported-color", "Indexed color-space lookup is not a string or stream.");
    const expected = (highValueRaw + 1) * base.componentCount;
    if (lookup.length < expected) throw new PdfError("unsupported-color", "Indexed color-space lookup is truncated.");
    return {
      ...colorRecord("Indexed", 1, [highValueRaw]),
      alternateSpaceIndex,
      lookup: lookup.slice(0, expected),
      highValue: highValueRaw
    };
  }

  private async parseSeparation(
    values: readonly PdfValue[],
    resources: PdfDictionary | undefined,
    stack: ColorParseStack,
    signal?: AbortSignal
  ): Promise<ColorRecord> {
    if (values.length !== 4) {
      throw new PdfError("unsupported-color", "Separation color-space array is malformed.");
    }
    const colorantName = await this.document.resolveValue(values[1], signal);
    if (!isPdfName(colorantName)) {
      throw new PdfError("unsupported-color", "A Separation colorant identifier must be a name.");
    }
    await this.assertDeclaredUnderlyingSpace(
      values[2],
      resources,
      stack,
      "Separation alternate",
      false,
      signal
    );
    const alternateSpaceIndex = await this.addInternal(values[2], resources, stack, signal);
    const alternate = this.getRecord(alternateSpaceIndex);
    const functionIndex = await this.functions.add(values[3], signal);
    const functionValue = this.functions.describe(functionIndex);
    if (functionValue.inputCount !== 1 || functionValue.outputCount !== alternate.componentCount) {
      throw new PdfError("unsupported-color", "A Separation tint transform has incompatible arity.");
    }
    return {
      ...colorRecord("Separation", 1, []),
      alternateSpaceIndex,
      functionIndex,
      names: [colorantName.value]
    };
  }

  private async parseDeviceN(
    values: readonly PdfValue[],
    resources: PdfDictionary | undefined,
    stack: ColorParseStack,
    signal?: AbortSignal
  ): Promise<ColorRecord> {
    if (values.length < 4 || values.length > 5) {
      throw new PdfError("unsupported-color", "DeviceN color-space array is malformed.");
    }
    const rawNames = await this.document.resolveValue(values[1], signal);
    if (!Array.isArray(rawNames) || rawNames.length === 0) {
      throw new PdfError("unsupported-color", "DeviceN colorant names must be a non-empty array.");
    }
    if (rawNames.length > this.maxDeviceNComponents) {
      throw new PdfError("resource-limit", "DeviceN colorant count exceeds its configured limit.");
    }
    const names: string[] = [];
    for (const rawName of rawNames) {
      throwIfAborted(signal);
      const entry = await this.document.resolveValue(rawName, signal);
      if (!isPdfName(entry)) {
        throw new PdfError("unsupported-color", "DeviceN colorant names must be names.");
      }
      if (entry.value === "All") {
        throw new PdfError("unsupported-color", "The /All colorant is not permitted in DeviceN.");
      }
      if (entry.value !== "None" && names.includes(entry.value)) {
        throw new PdfError("unsupported-color", "DeviceN colorant names must be unique except for /None.");
      }
      names.push(entry.value);
    }
    const subtype = await this.parseDeviceNSubtype(values[4], signal);
    if (subtype === "NChannel" && names.includes("None")) {
      throw new PdfError("unsupported-color", "/None colorants are not permitted in NChannel spaces.");
    }
    await this.assertDeclaredUnderlyingSpace(
      values[2],
      resources,
      stack,
      "DeviceN alternate",
      false,
      signal
    );
    const alternateSpaceIndex = await this.addInternal(values[2], resources, stack, signal);
    const alternate = this.getRecord(alternateSpaceIndex);
    const functionIndex = await this.functions.add(values[3], signal);
    const functionValue = this.functions.describe(functionIndex);
    if (functionValue.inputCount !== names.length || functionValue.outputCount !== alternate.componentCount) {
      throw new PdfError("unsupported-color", "A DeviceN tint transform has incompatible arity.");
    }
    return {
      ...colorRecord("DeviceN", names.length, []),
      alternateSpaceIndex,
      functionIndex,
      names
    };
  }

  private async parseDeviceNSubtype(
    rawAttributes: PdfValue | undefined,
    signal?: AbortSignal
  ): Promise<"DeviceN" | "NChannel"> {
    if (rawAttributes === undefined) return "DeviceN";
    const attributes = await this.document.resolveValue(rawAttributes, signal);
    if (!isPdfDictionary(attributes)) {
      throw new PdfError("unsupported-color", "DeviceN attributes must be a dictionary.");
    }
    if (!attributes.has("Subtype")) return "DeviceN";
    const subtype = await this.document.resolveValue(attributes.get("Subtype"), signal);
    if (!isPdfName(subtype) || (subtype.value !== "DeviceN" && subtype.value !== "NChannel")) {
      throw new PdfError("unsupported-color", "DeviceN attributes contain an invalid Subtype.");
    }
    // Colorants, Process, and MixingHints are intentionally left lazy. The
    // standard permits consumers to use the mandatory tint-transform fallback,
    // which is the self-contained representation serialized by this registry.
    return subtype.value;
  }

  private convertInternal(
    index: number,
    components: readonly number[],
    active: Set<number>,
    depth: number,
    signal?: AbortSignal
  ): readonly [number, number, number] {
    throwIfAborted(signal);
    if (depth >= this.maxColorDepth || active.has(index)) {
      throw new PdfError("unsupported-color", "A PDF color conversion graph is recursive.");
    }
    const record = this.getRecord(index);
    if (components.length !== record.componentCount || components.some((entry) => !Number.isFinite(entry))) {
      throw new PdfError("unsupported-color", `${record.kind} received an invalid component vector.`);
    }
    const next = new Set(active);
    next.add(index);
    let rgb: readonly [number, number, number];
    switch (record.kind) {
      case "DeviceGray": {
        const gray = clamp01(components[0]);
        rgb = [gray, gray, gray];
        break;
      }
      case "DeviceRGB":
        rgb = [clamp01(components[0]), clamp01(components[1]), clamp01(components[2])];
        break;
      case "DeviceCMYK": {
        const [c, m, y, k] = components.map(clamp01);
        rgb = convertDeviceCmykToSrgb(c, m, y, k);
        break;
      }
      case "CalGray": {
        const white = record.parameters.slice(0, 3);
        // ISO 32000 CalGray: X/Y/Z = WhitePoint * A^Gamma. BlackPoint is
        // retained in the store for output-device gamut mapping.
        const gray = Math.pow(clamp01(components[0]), record.parameters[6]);
        rgb = xyzToSrgb([white[0] * gray, white[1] * gray, white[2] * gray], white);
        break;
      }
      case "CalRGB": {
        const p = record.parameters;
        const white = p.slice(0, 3);
        // ISO 32000 CalRGB first applies A^GR, B^GG, C^GB, then multiplies
        // the decoded vector by [XA YA ZA XB YB ZB XC YC ZC].
        const a = Math.pow(clamp01(components[0]), p[6]);
        const b = Math.pow(clamp01(components[1]), p[7]);
        const c = Math.pow(clamp01(components[2]), p[8]);
        const matrix = p.slice(9, 18);
        rgb = xyzToSrgb([
          matrix[0] * a + matrix[3] * b + matrix[6] * c,
          matrix[1] * a + matrix[4] * b + matrix[7] * c,
          matrix[2] * a + matrix[5] * b + matrix[8] * c
        ], white);
        break;
      }
      case "Lab": {
        const p = record.parameters;
        const white = p.slice(0, 3);
        // ISO 32000 Lab uses L=(L*+16)/116+a*/500, M=(L*+16)/116,
        // N=(L*+16)/116-b*/200 followed by the standard piecewise inverse.
        const lightness = clamp(components[0], 0, 100);
        const a = clamp(components[1], p[6], p[7]);
        const b = clamp(components[2], p[8], p[9]);
        const m = (lightness + 16) / 116;
        rgb = xyzToSrgb([
          white[0] * labInverse(m + a / 500),
          white[1] * labInverse(m),
          white[2] * labInverse(m - b / 200)
        ], white);
        break;
      }
      case "ICCBased": {
        const normalized = normalizePairs(components, record.parameters);
        if (record.iccTransform) {
          rgb = sampleNativeIccTransform(
            record.iccTransform,
            record.componentCount as NativeIccComponentCount,
            normalized,
            signal
          );
          break;
        }
        if (!this.iccKernel || !record.iccMetadata) {
          // ISO 32000-1 8.6.5.5: the alternate space stands in when the profile
          // itself cannot be used. One is always present -- /Alternate when the
          // space supplies it, and the Device space matching /N otherwise -- and
          // its component count was checked when the space was parsed. Failing
          // the whole render instead would discard a page over colour fidelity
          // that the format itself declares optional.
          rgb = this.convertInternal(
            record.alternateSpaceIndex,
            normalized,
            next,
            depth + 1,
            signal
          );
          break;
        }
        try {
          rgb = validateKernelRgb(this.iccKernel.convertToSrgb(
            record.profile,
            normalized,
            record.iccMetadata
          ));
        } catch (cause) {
          if (cause instanceof PdfError) throw cause;
          throw new PdfError("unsupported-color", "The ICC color kernel rejected a profile.", { cause });
        }
        break;
      }
      case "Indexed": {
        const item = Math.round(clamp(components[0], 0, record.highValue));
        const base = this.getRecord(record.alternateSpaceIndex);
        const offset = item * base.componentCount;
        const ranges = this.defaultDecode(record.alternateSpaceIndex);
        const values = Array.from(record.lookup.subarray(offset, offset + base.componentCount),
          (entry, componentIndex) => {
            const low = ranges[componentIndex * 2];
            const high = ranges[componentIndex * 2 + 1];
            return low + (entry / 255) * (high - low);
          });
        rgb = this.convertInternal(record.alternateSpaceIndex, values, next, depth + 1, signal);
        break;
      }
      case "Separation":
      case "DeviceN": {
        if (
          (record.kind === "Separation" && (record.names[0] === "All" || record.names[0] === "None"))
          || (record.kind === "DeviceN" && record.names.every((name) => name === "None"))
        ) {
          throw new PdfError(
            "unsupported-color",
            "A special all/none colorant has no backdrop-independent sRGB value."
          );
        }
        const tint = this.functions.evaluate(record.functionIndex, components.map(clamp01), signal);
        rgb = this.convertInternal(record.alternateSpaceIndex, [...tint], next, depth + 1, signal);
        break;
      }
    }
    if (rgb.length !== 3 || rgb.some((entry) => !Number.isFinite(entry))) {
      throw new PdfError("unsupported-color", "A color conversion produced an invalid sRGB result.");
    }
    return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
  }

  private async resolveDictionary(value: PdfValue, signal?: AbortSignal): Promise<PdfDictionary> {
    const resolved = await this.document.resolveValue(value, signal);
    if (!isPdfDictionary(resolved)) throw new PdfError("unsupported-color", "Color-space parameters are not a dictionary.");
    return resolved;
  }

  private append(record: ColorRecord): number {
    if (record.componentCount > 255) {
      throw new PdfError("resource-limit", "A color space has too many components for HEPR v7.");
    }
    if (this.records.length >= this.maxColorSpaces) {
      throw new PdfError("resource-limit", "PDF color-space count exceeds its configured limit.");
    }
    const nextParameters = checkedStoreLength(
      this.parameterValueCount,
      record.parameters.length,
      this.maxStoreValues,
      "parameter"
    );
    const nextNames = checkedStoreLength(
      this.nameValueCount,
      record.names.length,
      this.maxStoreValues,
      "name"
    );
    const nextBytes = checkedStoreLength(
      this.storedByteCount,
      record.profile.length + record.lookup.length,
      this.maxStoreBytes,
      "byte"
    );
    const index = this.records.length;
    this.parameterValueCount = nextParameters;
    this.nameValueCount = nextNames;
    this.storedByteCount = nextBytes;
    this.records.push(Object.freeze(record) as ColorRecord);
    return index;
  }

  private getRecord(index: number): ColorRecord {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.records.length) {
      throw new RangeError(`PDF color-space index ${index} is out of range.`);
    }
    return this.records[index];
  }
}

function colorRecord(
  kind: NativePdfColorSpaceKind,
  componentCount: number,
  parameters: readonly number[]
): ColorRecord {
  return {
    kind,
    componentCount,
    alternateSpaceIndex: -1,
    functionIndex: -1,
    parameters,
    names: [],
    profile: new Uint8Array(0),
    lookup: new Uint8Array(0),
    iccMetadata: null,
    iccTransform: null,
    highValue: -1
  };
}

function heprColorKind(kind: NativePdfColorSpaceKind): number {
  switch (kind) {
    case "DeviceGray": return HEPR_COLOR_SPACE_KIND.DeviceGray;
    case "DeviceRGB": return HEPR_COLOR_SPACE_KIND.DeviceRgb;
    case "DeviceCMYK": return HEPR_COLOR_SPACE_KIND.DeviceCmyk;
    case "CalGray": return HEPR_COLOR_SPACE_KIND.CalGray;
    case "CalRGB": return HEPR_COLOR_SPACE_KIND.CalRgb;
    case "Lab": return HEPR_COLOR_SPACE_KIND.Lab;
    case "ICCBased": return HEPR_COLOR_SPACE_KIND.IccBased;
    case "Indexed": return HEPR_COLOR_SPACE_KIND.Indexed;
    case "Separation": return HEPR_COLOR_SPACE_KIND.Separation;
    case "DeviceN": return HEPR_COLOR_SPACE_KIND.DeviceN;
  }
}

function normalizeDeviceName(value: string): "DeviceGray" | "DeviceRGB" | "DeviceCMYK" | null {
  if (value === "DeviceGray" || value === "G") return "DeviceGray";
  if (value === "DeviceRGB" || value === "RGB") return "DeviceRGB";
  if (value === "DeviceCMYK" || value === "CMYK") return "DeviceCMYK";
  return null;
}

function normalizeColorFamily(value: string): string {
  if (value === "I") return "Indexed";
  return value;
}

function requireColorArrayArity(
  values: readonly PdfValue[],
  expected: number,
  family: string
): void {
  if (values.length !== expected) {
    throw new PdfError("unsupported-color", `${family} color-space array has invalid arity.`);
  }
}

function isPatternColorSpaceValue(value: PdfValue): boolean {
  return isPdfName(value, "Pattern")
    || (Array.isArray(value) && isPdfName(value[0], "Pattern"));
}

async function requiredInteger(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  signal?: AbortSignal
): Promise<number> {
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new PdfError("unsupported-color", `Color-space /${key} must be an integer.`);
  }
  return value;
}

async function optionalNumber(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  fallback: number,
  signal?: AbortSignal
): Promise<number> {
  if (!dictionary.has(key)) return fallback;
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || Math.abs(value) > 3.402823466e38
  ) {
    throw new PdfError("unsupported-color", `Color-space /${key} must be a finite number.`);
  }
  return value;
}

async function requiredNumbers(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  length: number,
  signal?: AbortSignal
): Promise<number[]> {
  const values = await resolveNumbers(document, dictionary.get(key), length, signal);
  if (values.length !== length) {
    throw new PdfError("unsupported-color", `Color-space /${key} must contain ${length} numbers.`);
  }
  return values;
}

async function optionalNumbers(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  fallback: readonly number[],
  signal?: AbortSignal
): Promise<number[]> {
  if (!dictionary.has(key)) return [...fallback];
  return await resolveNumbers(document, dictionary.get(key), fallback.length, signal);
}

async function resolveNumbers(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  expectedLength: number,
  signal?: AbortSignal
): Promise<number[]> {
  const resolved = await document.resolveValue(value, signal);
  if (!Array.isArray(resolved)) throw new PdfError("unsupported-color", "A color-space numeric array is malformed.");
  if (resolved.length !== expectedLength) {
    throw new PdfError(
      "unsupported-color",
      `A color-space numeric array must contain ${expectedLength} values.`
    );
  }
  const output: number[] = [];
  for (const raw of resolved) {
    throwIfAborted(signal);
    const item = await document.resolveValue(raw, signal);
    if (typeof item !== "number" || !Number.isFinite(item) || Math.abs(item) > 3.402823466e38) {
      throw new PdfError("unsupported-color", "A color-space array contains an invalid number.");
    }
    output.push(item);
  }
  return output;
}

function validateWhitePoint(values: readonly number[]): void {
  if (!(values[0] > 0) || values[1] !== 1 || !(values[2] > 0)) {
    throw new PdfError("unsupported-color", "A calibrated color-space WhitePoint is invalid.");
  }
}

function validateNonnegativeTriple(values: readonly number[], label: string): void {
  if (values.length !== 3 || values.some((value) => value < 0)) {
    throw new PdfError("unsupported-color", `${label} must contain three nonnegative values.`);
  }
}

function validateIntervals(values: readonly number[], label: string): void {
  if (values.length === 0 || values.length % 2 !== 0) {
    throw new PdfError("unsupported-color", `${label} has invalid arity.`);
  }
  for (let index = 0; index < values.length; index += 2) {
    if (values[index] > values[index + 1]) {
      throw new PdfError("unsupported-color", `${label} contains a reversed interval.`);
    }
  }
}

export function parseIccMetadata(profile: Uint8Array): Readonly<NativeIccProfileMetadata> {
  if (profile.length < 128) throw new PdfError("unsupported-color", "An ICC profile header is truncated.");
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const declaredSize = view.getUint32(0, false);
  if (declaredSize < 128 || declaredSize > profile.length) {
    throw new PdfError("unsupported-color", "An ICC profile has an invalid declared size.", {
      details: { declaredSize, actualSize: profile.length }
    });
  }
  if (asciiSignature(profile, 36) !== "acsp") {
    throw new PdfError("unsupported-color", "An ICC profile is missing its required acsp signature.");
  }
  return Object.freeze({
    declaredSize,
    preferredCmm: asciiSignature(profile, 4),
    versionMajor: profile[8],
    deviceClass: asciiSignature(profile, 12),
    dataColorSpace: asciiSignature(profile, 16),
    connectionSpace: asciiSignature(profile, 20)
  });
}

function validatePdfIccMetadata(
  metadata: Readonly<NativeIccProfileMetadata>,
  expectedComponents: number
): void {
  const componentCount = metadata.dataColorSpace === "GRAY"
    ? 1
    : metadata.dataColorSpace === "RGB " || metadata.dataColorSpace === "Lab "
      ? 3
      : metadata.dataColorSpace === "CMYK"
        ? 4
        : 0;
  if (componentCount !== expectedComponents) {
    throw new PdfError(
      "unsupported-color",
      "An ICC profile data color space does not match /N or is unsupported.",
      { details: { dataColorSpace: metadata.dataColorSpace, expectedComponents } }
    );
  }
  if (!["scnr", "mntr", "prtr", "spac"].includes(metadata.deviceClass)) {
    throw new PdfError("unsupported-color", "An ICC profile has a PDF-unsupported device class.", {
      details: { deviceClass: metadata.deviceClass }
    });
  }
  if (metadata.connectionSpace !== "XYZ " && metadata.connectionSpace !== "Lab ") {
    throw new PdfError("unsupported-color", "An ICC profile has an unsupported connection space.", {
      details: { connectionSpace: metadata.connectionSpace }
    });
  }
}

function validateKernelRgb(value: readonly number[]): readonly [number, number, number] {
  if (
    value === null
    || value === undefined
    || typeof value.length !== "number"
    || value.length !== 3
    || !Number.isFinite(value[0])
    || !Number.isFinite(value[1])
    || !Number.isFinite(value[2])
  ) {
    throw new PdfError("unsupported-color", "The ICC color kernel returned an invalid sRGB vector.");
  }
  return [value[0], value[1], value[2]];
}

function asciiSignature(bytes: Uint8Array, offset: number): string {
  let output = "";
  for (let index = 0; index < 4; index += 1) output += String.fromCharCode(bytes[offset + index]);
  return output;
}

function xyzToSrgb(
  xyz: readonly number[],
  sourceWhite: readonly number[]
): readonly [number, number, number] {
  const adapted = adaptBradford(xyz, sourceWhite, D65);
  const red = 3.2404542 * adapted[0] - 1.5371385 * adapted[1] - 0.4985314 * adapted[2];
  const green = -0.969266 * adapted[0] + 1.8760108 * adapted[1] + 0.041556 * adapted[2];
  const blue = 0.0556434 * adapted[0] - 0.2040259 * adapted[1] + 1.0572252 * adapted[2];
  return [srgbCompand(red), srgbCompand(green), srgbCompand(blue)];
}

function adaptBradford(
  xyz: readonly number[],
  sourceWhite: readonly number[],
  targetWhite: readonly number[]
): readonly [number, number, number] {
  const sourceCone = multiply3x3([
    0.8951, 0.2664, -0.1614,
    -0.7502, 1.7135, 0.0367,
    0.0389, -0.0685, 1.0296
  ], sourceWhite);
  const targetCone = multiply3x3([
    0.8951, 0.2664, -0.1614,
    -0.7502, 1.7135, 0.0367,
    0.0389, -0.0685, 1.0296
  ], targetWhite);
  const cone = multiply3x3([
    0.8951, 0.2664, -0.1614,
    -0.7502, 1.7135, 0.0367,
    0.0389, -0.0685, 1.0296
  ], xyz);
  return multiply3x3([
    0.9869929, -0.1470543, 0.1599627,
    0.4323053, 0.5183603, 0.0492912,
    -0.0085287, 0.0400428, 0.9684867
  ], [
    cone[0] * targetCone[0] / sourceCone[0],
    cone[1] * targetCone[1] / sourceCone[1],
    cone[2] * targetCone[2] / sourceCone[2]
  ]);
}

function multiply3x3(matrix: readonly number[], vector: readonly number[]): [number, number, number] {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2]
  ];
}

function labInverse(value: number): number {
  const delta = 6 / 29;
  return value >= delta ? value ** 3 : 3 * delta * delta * (value - 4 / 29);
}

function srgbCompand(value: number): number {
  return clamp01(value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055);
}

function normalizePairs(values: readonly number[], pairs: readonly number[]): number[] {
  return values.map((value, index) => {
    const low = pairs[index * 2];
    const high = pairs[index * 2 + 1];
    if (low === high) return 0;
    return (clamp(value, low, high) - low) / (high - low);
  });
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(Math.min(low, high), Math.min(Math.max(low, high), value));
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
  return value;
}

function boundedLimit(value: number, maximum: number, name: string): number {
  const result = positiveLimit(value, name);
  if (result > maximum) throw new RangeError(`${name} cannot exceed ${maximum}.`);
  return result;
}

function checkedStoreLength(
  current: number,
  added: number,
  limit: number,
  label: string
): number {
  if (!Number.isSafeInteger(added) || added < 0 || added > limit - current) {
    throw new PdfError("resource-limit", `PDF color ${label} store exceeds its configured limit.`);
  }
  return current + added;
}

function allocateStore<T>(factory: () => T, label: string): T {
  try {
    return factory();
  } catch (cause) {
    throw new PdfError("resource-limit", `Unable to allocate the ${label}.`, { cause });
  }
}

function copyFloatValues(
  target: Float32Array,
  offset: number,
  values: readonly number[],
  signal?: AbortSignal
): number {
  for (let index = 0; index < values.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    target[offset + index] = values[index];
  }
  return offset + values.length;
}

function copyStringValues(
  target: string[],
  offset: number,
  values: readonly string[],
  signal?: AbortSignal
): number {
  for (let index = 0; index < values.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    target[offset + index] = values[index];
  }
  return offset + values.length;
}

function copyByteValues(
  target: Uint8Array,
  offset: number,
  values: Uint8Array,
  signal?: AbortSignal
): number {
  const chunkSize = 16_384;
  for (let index = 0; index < values.length; index += chunkSize) {
    throwIfAborted(signal);
    const end = Math.min(values.length, index + chunkSize);
    target.set(values.subarray(index, end), offset + index);
  }
  return offset + values.length;
}
