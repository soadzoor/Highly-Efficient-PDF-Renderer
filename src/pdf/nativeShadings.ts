import {
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  pdfRefKey,
  type PdfDictionary,
  type PdfStream,
  type PdfValue
} from "./nativeCos";
import {
  NativePdfColorRegistry,
  type NativePdfColorSpaceDescription
} from "./nativeColor";
import type { NativePdfDocument } from "./nativeDocument";
import {
  type NativePdfFunctionDescription,
  type NativePdfFunctionRegistry
} from "./nativeFunctions";
import { PdfError, throwIfAborted } from "./nativeTypes";
import {
  HEPR_GRADIENT_KIND,
  HEPR_MESH_KIND,
  type HeprGradientStore,
  type HeprMeshStore
} from "../heprDocumentData";

export type NativePdfShadingType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type NativePdfShadingKind =
  | "function"
  | "axial"
  | "radial"
  | "free-form-mesh"
  | "lattice-mesh"
  | "coons-patch-mesh"
  | "tensor-patch-mesh";

export type NativePdfShadingRectangle = readonly [number, number, number, number];
export type NativePdfShadingMatrix = readonly [number, number, number, number, number, number];

/**
 * Flags serialized in `HeprGradientStore.extendFlags` by this registry.
 *
 * The first two bits retain their ordinary axial/radial meaning. The remaining
 * bits make common shading-dictionary semantics explicit without changing the
 * page-native v7 ABI.
 */
export const NATIVE_PDF_SHADING_STORE_FLAGS = {
  ExtendStart: 1 << 0,
  ExtendEnd: 1 << 1,
  AntiAlias: 1 << 2,
  HasBoundingBox: 1 << 3,
  HasBackground: 1 << 4,
  HasFunctionArray: 1 << 5
} as const;

export interface NativePdfShadingDescription {
  readonly shadingType: NativePdfShadingType;
  readonly kind: NativePdfShadingKind;
  readonly colorSpaceIndex: number;
  /** Scalar function index, or -1 when absent or represented by `functionIndices`. */
  readonly functionIndex: number;
  /** One entry for a scalar function, N entries for an N-component function array. */
  readonly functionIndices: readonly number[];
  readonly meshIndex: number;
  /** Type 2 has four values, type 3 has six, and other types have none. */
  readonly coordinates: readonly number[];
  /** Type 1 has two input intervals; types 2/3 have one; mesh types have none. */
  readonly domain: readonly number[];
  /** Present only for type 1. */
  readonly matrix: NativePdfShadingMatrix | null;
  readonly boundingBox: NativePdfShadingRectangle | null;
  readonly background: readonly number[] | null;
  readonly extend: readonly [boolean, boolean];
  readonly antiAlias: boolean;
}

export interface NativePdfShadingOptions {
  /** Maximum triangle vertices or expanded patch control points. Defaults to the path ceiling. */
  readonly maxMeshVertices?: number;
}

interface ShadingRecord extends NativePdfShadingDescription {
  readonly storeCoordinates: readonly number[];
}

interface MeshRecord {
  readonly kind: number;
  readonly positions: readonly number[];
  /** Four slots per vertex/control point. See `buildMeshStore()` for the exact convention. */
  readonly colors: readonly number[];
  readonly indices: readonly number[];
  readonly colorSpaceIndex: number;
}

interface ParseStack {
  readonly refs: ReadonlySet<string>;
  readonly objects: ReadonlySet<object>;
  readonly resourceNames: ReadonlySet<string>;
}

interface CommonShadingValues {
  readonly colorSpaceIndex: number;
  readonly colorSpace: Readonly<NativePdfColorSpaceDescription>;
  readonly boundingBox: NativePdfShadingRectangle | null;
  readonly background: readonly number[] | null;
  readonly antiAlias: boolean;
}

interface DecodedMesh {
  readonly positions: readonly number[];
  readonly colors: readonly number[];
  readonly flags: readonly number[];
}

interface DecodedPatchMesh {
  /** Expanded complete control nets: 12 points for type 6, 16 for type 7. */
  readonly positions: readonly number[];
  /** Four slots per control point; corner payloads are at points 0, 3, 6, 9. */
  readonly colors: readonly number[];
  /** Source-ordered groups of 12/16 local control-point indexes. */
  readonly indices: readonly number[];
}

interface ResolvedShadingFunctions {
  readonly primaryIndex: number;
  readonly indices: readonly number[];
}

const IDENTITY_MATRIX: NativePdfShadingMatrix = Object.freeze([1, 0, 0, 1, 0, 0]);
const DEFAULT_TYPE_1_DOMAIN = Object.freeze([0, 1, 0, 1]);
const DEFAULT_PARAMETER_DOMAIN = Object.freeze([0, 1]);
const EMPTY_EXTEND = Object.freeze([false, false]) as readonly [false, false];
const VALID_COORDINATE_BITS = new Set([1, 2, 4, 8, 12, 16, 24, 32]);
const VALID_COMPONENT_BITS = new Set([1, 2, 4, 8, 12, 16]);
const VALID_FLAG_BITS = new Set([2, 4, 8]);

/**
 * Resolves, validates, deduplicates, and serializes native PDF shadings.
 *
 * `HeprGradientStore.coordinates` uses these stable per-kind layouts:
 *
 * - function: `[domain(4), matrix(6), functionArray?(n), bbox?(4), background?(n)]`
 * - axial: `[coords(4), domain(2), functionArray?(n), bbox?(4), background?(n)]`
 * - radial: `[coords(6), domain(2), functionArray?(n), bbox?(4), background?(n)]`
 * - mesh: `[functionArray?(n), bbox?(4), background?(n)]`; vertices live in `HeprMeshStore`
 *
 * Presence of the optional tails is encoded by
 * `NATIVE_PDF_SHADING_STORE_FLAGS`. Function-backed mesh vertices retain the
 * parametric `t` value in color slot zero so interpolation happens before the
 * referenced function is evaluated, as required by PDF. Meshes without a
 * function retain up to four source color components, zero-padded to four.
 * `colorSpaceIndices` identifies the interpretation in both cases.
 *
 * A PDF function array uses `functionIndices[index] === -1`, sets
 * `HasFunctionArray`, and stores its N exact function indexes in the coordinate
 * payload. Indexes are bounded to Float32's exact-integer range.
 */
export class NativePdfShadingRegistry {
  readonly document: NativePdfDocument;
  readonly colors: NativePdfColorRegistry;
  readonly functions: NativePdfFunctionRegistry;

  private readonly maxMeshVertices: number;
  private readonly records: ShadingRecord[] = [];
  private readonly meshRecords: MeshRecord[] = [];
  private readonly refCache = new Map<string, Promise<number>>();
  private readonly objectCache = new WeakMap<object, Map<number, Promise<number>>>();
  private readonly resourceCache = new WeakMap<PdfDictionary, Map<string, Promise<number>>>();
  private readonly pageResourceCache = new Map<number, PdfDictionary>();
  private readonly scopeIds = new WeakMap<PdfDictionary, number>();
  private nextScopeId = 1;

  constructor(
    document: NativePdfDocument,
    colors?: NativePdfColorRegistry,
    options: NativePdfShadingOptions = {}
  ) {
    this.document = document;
    this.colors = colors ?? new NativePdfColorRegistry(document);
    this.functions = this.colors.functions;
    const configured = options.maxMeshVertices ?? document.limits.maxPathsPerPage;
    if (!Number.isSafeInteger(configured) || configured <= 0) {
      throw new RangeError("maxMeshVertices must be a positive safe integer.");
    }
    this.maxMeshVertices = Math.min(configured, document.limits.maxPathsPerPage, 0xffff_ffff);
  }

  get size(): number {
    return this.records.length;
  }

  get meshSize(): number {
    return this.meshRecords.length;
  }

  /** Resolve a `/Shading` entry in one page's inherited resource scope. */
  async resolvePageShading(
    pageIndex: number,
    resourceName: string,
    signal?: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    const page = this.document.getPage(pageIndex);
    let resources = this.pageResourceCache.get(pageIndex);
    if (!resources) {
      if (page.resources === undefined || page.resources === null) {
        throw shadingError(`Page ${pageIndex} has no resources for shading /${normalizeName(resourceName)}.`, {
          reason: "missing-page-resources",
          pageIndex
        });
      }
      resources = await this.document.resolveDictionary(page.resources, signal);
      this.pageResourceCache.set(pageIndex, resources);
    }
    return await this.addResourceName(normalizeName(resourceName), resources, emptyStack(), signal);
  }

  /** Add a direct/ref shading or a name resolved through the supplied resources. */
  async add(
    value: PdfValue,
    resources?: PdfDictionary,
    signal?: AbortSignal
  ): Promise<number> {
    return await this.addInternal(value, resources, emptyStack(), signal);
  }

  describe(index: number): Readonly<NativePdfShadingDescription> {
    return this.getRecord(index);
  }

  buildGradientStore(): HeprGradientStore {
    const count = this.records.length;
    const kinds = new Uint8Array(count);
    const colorSpaceIndices = new Int32Array(count);
    const functionIndices = new Int32Array(count);
    const meshIndices = new Int32Array(count);
    const extendFlags = new Uint8Array(count);
    const coordinateOffsets = [0];
    const stopOffsets = [0];
    const coordinates: number[] = [];

    for (let index = 0; index < count; index += 1) {
      const record = this.records[index];
      kinds[index] = gradientKind(record.shadingType);
      colorSpaceIndices[index] = record.colorSpaceIndex;
      functionIndices[index] = record.functionIndex;
      meshIndices[index] = record.meshIndex;
      extendFlags[index] = encodeStoreFlags(record);
      coordinates.push(...record.storeCoordinates);
      coordinateOffsets.push(coordinates.length);
      stopOffsets.push(0);
    }

    assertFloat32Values(coordinates, "A shading coordinate payload");
    return {
      kinds,
      colorSpaceIndices,
      functionIndices,
      coordinateOffsets: Uint32Array.from(coordinateOffsets),
      coordinates: Float32Array.from(coordinates),
      stopOffsets: Uint32Array.from(stopOffsets),
      stopPositions: new Float32Array(0),
      stopPaintIndices: new Uint32Array(0),
      meshIndices,
      extendFlags
    };
  }

  /**
   * Build vector mesh resources shared by shading types 4 through 7.
   *
   * Index values are global across the concatenated vertex/control-point
   * arrays. Triangle mesh indices are groups of three. Coons/tensor patch
   * indices are source-ordered groups of 12/16 control points respectively.
   * Patch continuation records are expanded into complete self-contained
   * patches. Their four corner payloads live at control-point slots 0, 3, 6,
   * and 9; non-corner color slots are zero. A scalar/array function uses color
   * slot zero for `t`; otherwise the first N slots are native components.
   * This representation preserves the exact PDF control net and nonlinear
   * function-before-colour semantics for procedural GPU tessellation.
   */
  buildMeshStore(): HeprMeshStore {
    const count = this.meshRecords.length;
    const kinds = new Uint8Array(count);
    const colorSpaceIndices = new Int32Array(count);
    const vertexOffsets = [0];
    const indexOffsets = [0];
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    for (let index = 0; index < count; index += 1) {
      const record = this.meshRecords[index];
      const vertexBase = positions.length / 2;
      kinds[index] = record.kind;
      colorSpaceIndices[index] = record.colorSpaceIndex;
      positions.push(...record.positions);
      colors.push(...record.colors);
      for (const vertexIndex of record.indices) indices.push(vertexBase + vertexIndex);
      vertexOffsets.push(positions.length / 2);
      indexOffsets.push(indices.length);
    }

    assertFloat32Values(positions, "A mesh position payload");
    assertFloat32Values(colors, "A mesh color payload");
    return {
      kinds,
      vertexOffsets: Uint32Array.from(vertexOffsets),
      indexOffsets: Uint32Array.from(indexOffsets),
      positions: Float32Array.from(positions),
      colors: Float32Array.from(colors),
      indices: Uint32Array.from(indices),
      colorSpaceIndices
    };
  }

  private async addInternal(
    value: PdfValue,
    resources: PdfDictionary | undefined,
    stack: ParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    if (isPdfRef(value)) {
      const identity = pdfRefKey(value);
      if (stack.refs.has(identity)) {
        throw shadingError("A PDF shading resource graph contains a cycle.", {
          reason: "shading-cycle",
          objectNumber: value.objectNumber
        });
      }
      const key = `${identity}@${this.scopeId(resources)}`;
      const cached = this.refCache.get(key);
      if (cached) return await cached;
      const refs = new Set(stack.refs);
      refs.add(identity);
      const pending = Promise.resolve()
        .then(() => this.document.resolveObject(value, signal))
        .then((resolved) => this.addInternal(resolved, resources, { ...stack, refs }, signal));
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
        throw shadingError(`Shading name /${value.value} has no resource scope.`, {
          reason: "missing-resource-scope",
          resourceName: value.value
        });
      }
      return await this.addResourceName(value.value, resources, stack, signal);
    }

    if (!isPdfDictionary(value) && !isPdfStream(value)) {
      throw new PdfError("invalid-object", "A PDF shading must be a dictionary or stream.", {
        details: { feature: "shading" }
      });
    }
    if (stack.objects.has(value)) {
      throw shadingError("A direct PDF shading resource graph contains a cycle.", {
        reason: "shading-cycle"
      });
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
    const pending = Promise.resolve()
      .then(() => this.parseAndAppend(value, resources, signal));
    scopedCache.set(scopeId, pending);
    try {
      return await pending;
    } catch (error) {
      scopedCache.delete(scopeId);
      throw error;
    }
  }

  private async addResourceName(
    name: string,
    resources: PdfDictionary,
    stack: ParseStack,
    signal?: AbortSignal
  ): Promise<number> {
    const normalized = normalizeName(name);
    const identity = `${this.scopeId(resources)}:${normalized}`;
    if (stack.resourceNames.has(identity)) {
      throw shadingError(`Shading resource /${normalized} is recursive.`, {
        reason: "shading-resource-cycle",
        resourceName: normalized
      });
    }
    const rawShadings = resources.get("Shading");
    if (rawShadings === undefined || rawShadings === null) {
      throw shadingError(`Missing /Shading resources while resolving /${normalized}.`, {
        reason: "missing-shading-resources",
        resourceName: normalized
      });
    }
    const shadings = await this.document.resolveDictionary(rawShadings, signal);
    // Cache by the complete resource scope, not merely by the /Shading
    // dictionary: one shared shading dictionary may legally resolve named
    // color spaces differently in two enclosing resource dictionaries.
    let cache = this.resourceCache.get(resources);
    if (!cache) {
      cache = new Map();
      this.resourceCache.set(resources, cache);
    }
    const cached = cache.get(normalized);
    if (cached) return await cached;
    const raw = shadings.get(normalized);
    if (raw === undefined || raw === null) {
      throw shadingError(`Unknown PDF shading resource /${normalized}.`, {
        reason: "missing-shading-resource",
        resourceName: normalized
      });
    }
    const resourceNames = new Set(stack.resourceNames);
    resourceNames.add(identity);
    const pending = this.addInternal(raw, resources, { ...stack, resourceNames }, signal);
    cache.set(normalized, pending);
    try {
      return await pending;
    } catch (error) {
      cache.delete(normalized);
      throw error;
    }
  }

  private async parseAndAppend(
    value: PdfValue,
    resources: PdfDictionary | undefined,
    signal?: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    const stream = isPdfStream(value) ? value : null;
    const dictionary = stream?.dictionary ?? (isPdfDictionary(value) ? value : null);
    if (!dictionary) {
      throw new PdfError("invalid-object", "A PDF shading did not resolve to a dictionary or stream.", {
        details: { feature: "shading" }
      });
    }
    const shadingType = await requiredInteger(this.document, dictionary, "ShadingType", signal);
    if (shadingType < 1 || shadingType > 7) {
      throw shadingError(`Unsupported PDF ShadingType ${shadingType}.`, {
        reason: "unsupported-shading-type",
        shadingType
      });
    }
    if (shadingType <= 3 && stream) {
      throw new PdfError("invalid-object", `PDF ShadingType ${shadingType} must be a dictionary, not a stream.`, {
        details: { feature: "shading", shadingType }
      });
    }
    if (shadingType >= 4 && !stream) {
      throw new PdfError("invalid-object", `PDF ShadingType ${shadingType} must be a stream.`, {
        details: { feature: "shading", shadingType }
      });
    }

    const supportedShadingType = shadingType as NativePdfShadingType;
    const common = await this.parseCommon(dictionary, resources, signal);
    let record: ShadingRecord | null = null;
    let mesh: MeshRecord | null = null;
    switch (supportedShadingType) {
      case 1:
        record = await this.parseFunctionShading(dictionary, common, signal);
        break;
      case 2:
        record = await this.parseAxialShading(dictionary, common, signal);
        break;
      case 3:
        record = await this.parseRadialShading(dictionary, common, signal);
        break;
      case 4: {
        const parsed = await this.parseMeshShading(stream!, common, 4, signal);
        record = parsed.record;
        mesh = parsed.mesh;
        break;
      }
      case 5: {
        const parsed = await this.parseMeshShading(stream!, common, 5, signal);
        record = parsed.record;
        mesh = parsed.mesh;
        break;
      }
      case 6:
      case 7: {
        const parsed = await this.parsePatchMeshShading(
          stream!,
          common,
          supportedShadingType,
          signal
        );
        record = parsed.record;
        mesh = parsed.mesh;
        break;
      }
    }

    if (!record) {
      throw shadingError(`Unsupported PDF ShadingType ${shadingType}.`, {
        reason: "unsupported-shading-type",
        shadingType
      });
    }
    if (
      record.colorSpaceIndex > 0x7fff_ffff ||
      record.functionIndex > 0x7fff_ffff ||
      record.functionIndices.some((index) => index > 0x7fff_ffff)
    ) {
      throw new PdfError("resource-limit", "A shading resource index exceeds the HEPR v7 ABI.", {
        details: { feature: "shading" }
      });
    }
    if (mesh) {
      // Assign the mesh index only at the synchronous append point. Parallel
      // shading resolutions can finish decoding in adjacent microtasks.
      record = { ...record, meshIndex: this.meshRecords.length };
      this.meshRecords.push(Object.freeze(mesh));
    }
    const index = this.records.length;
    this.records.push(Object.freeze(record));
    return index;
  }

  private async parseCommon(
    dictionary: PdfDictionary,
    resources: PdfDictionary | undefined,
    signal?: AbortSignal
  ): Promise<CommonShadingValues> {
    const rawColorSpace = dictionary.get("ColorSpace");
    if (rawColorSpace === undefined || rawColorSpace === null) {
      throw new PdfError("invalid-object", "A PDF shading is missing /ColorSpace.", {
        details: { feature: "shading" }
      });
    }
    const colorResources = await optionalResourceDictionary(
      this.document,
      resources,
      "ColorSpace",
      signal
    );
    const colorSpaceIndex = await this.colors.add(rawColorSpace, colorResources, signal);
    const colorSpace = this.colors.describe(colorSpaceIndex);
    const boundingBox = dictionary.has("BBox")
      ? normalizeRectangle(await requiredNumberArray(this.document, dictionary, "BBox", 4, signal))
      : null;
    const background = dictionary.has("Background")
      ? freezeNumbers(await requiredNumberArray(
          this.document,
          dictionary,
          "Background",
          colorSpace.componentCount,
          signal
        ))
      : null;
    const antiAlias = await optionalBoolean(this.document, dictionary, "AntiAlias", false, signal);
    return { colorSpaceIndex, colorSpace, boundingBox, background, antiAlias };
  }

  private async parseFunctionShading(
    dictionary: PdfDictionary,
    common: CommonShadingValues,
    signal?: AbortSignal
  ): Promise<ShadingRecord> {
    const domain = dictionary.has("Domain")
      ? await requiredNumberArray(this.document, dictionary, "Domain", 4, signal)
      : DEFAULT_TYPE_1_DOMAIN;
    validateOrderedIntervals(domain, "Type 1 shading /Domain");
    const matrix = dictionary.has("Matrix")
      ? asMatrix(await requiredNumberArray(this.document, dictionary, "Matrix", 6, signal))
      : IDENTITY_MATRIX;
    const functions = await this.parseRequiredFunctions(
      dictionary,
      2,
      common.colorSpace.componentCount,
      domain,
      signal
    );
    const frozenDomain = freezeNumbers(domain);
    return this.makeRecord({
      shadingType: 1,
      kind: "function",
      common,
      functionIndex: functions.primaryIndex,
      functionIndices: functions.indices,
      meshIndex: -1,
      coordinates: [],
      domain: frozenDomain,
      matrix,
      extend: EMPTY_EXTEND,
      storeCoordinates: [
        ...frozenDomain,
        ...matrix,
        ...(functions.primaryIndex < 0 ? functions.indices : []),
        ...(common.boundingBox ?? []),
        ...(common.background ?? [])
      ]
    });
  }

  private async parseAxialShading(
    dictionary: PdfDictionary,
    common: CommonShadingValues,
    signal?: AbortSignal
  ): Promise<ShadingRecord> {
    const coordinates = freezeNumbers(await requiredNumberArray(
      this.document,
      dictionary,
      "Coords",
      4,
      signal
    ));
    if (coordinates[0] === coordinates[2] && coordinates[1] === coordinates[3]) {
      throw new PdfError("invalid-object", "An axial shading axis has coincident endpoints.", {
        details: { feature: "shading", shadingType: 2 }
      });
    }
    const domain = dictionary.has("Domain")
      ? await requiredNumberArray(this.document, dictionary, "Domain", 2, signal)
      : DEFAULT_PARAMETER_DOMAIN;
    validateOrderedIntervals(domain, "Axial shading /Domain");
    const extend = await readExtend(this.document, dictionary, signal);
    const functions = await this.parseRequiredFunctions(
      dictionary,
      1,
      common.colorSpace.componentCount,
      domain,
      signal
    );
    const frozenDomain = freezeNumbers(domain);
    return this.makeRecord({
      shadingType: 2,
      kind: "axial",
      common,
      functionIndex: functions.primaryIndex,
      functionIndices: functions.indices,
      meshIndex: -1,
      coordinates,
      domain: frozenDomain,
      matrix: null,
      extend,
      storeCoordinates: [
        ...coordinates,
        ...frozenDomain,
        ...(functions.primaryIndex < 0 ? functions.indices : []),
        ...(common.boundingBox ?? []),
        ...(common.background ?? [])
      ]
    });
  }

  private async parseRadialShading(
    dictionary: PdfDictionary,
    common: CommonShadingValues,
    signal?: AbortSignal
  ): Promise<ShadingRecord> {
    const coordinates = freezeNumbers(await requiredNumberArray(
      this.document,
      dictionary,
      "Coords",
      6,
      signal
    ));
    if (coordinates[2] < 0 || coordinates[5] < 0) {
      throw new PdfError("invalid-object", "A radial shading radius cannot be negative.", {
        details: { feature: "shading", shadingType: 3 }
      });
    }
    if (
      coordinates[0] === coordinates[3] &&
      coordinates[1] === coordinates[4] &&
      coordinates[2] === coordinates[5]
    ) {
      throw new PdfError("invalid-object", "A radial shading's two circles are identical.", {
        details: { feature: "shading", shadingType: 3 }
      });
    }
    const domain = dictionary.has("Domain")
      ? await requiredNumberArray(this.document, dictionary, "Domain", 2, signal)
      : DEFAULT_PARAMETER_DOMAIN;
    validateOrderedIntervals(domain, "Radial shading /Domain");
    const extend = await readExtend(this.document, dictionary, signal);
    const functions = await this.parseRequiredFunctions(
      dictionary,
      1,
      common.colorSpace.componentCount,
      domain,
      signal
    );
    const frozenDomain = freezeNumbers(domain);
    return this.makeRecord({
      shadingType: 3,
      kind: "radial",
      common,
      functionIndex: functions.primaryIndex,
      functionIndices: functions.indices,
      meshIndex: -1,
      coordinates,
      domain: frozenDomain,
      matrix: null,
      extend,
      storeCoordinates: [
        ...coordinates,
        ...frozenDomain,
        ...(functions.primaryIndex < 0 ? functions.indices : []),
        ...(common.boundingBox ?? []),
        ...(common.background ?? [])
      ]
    });
  }

  private async parseMeshShading(
    stream: PdfStream,
    common: CommonShadingValues,
    shadingType: 4 | 5,
    signal?: AbortSignal
  ): Promise<{ readonly record: ShadingRecord; readonly mesh: MeshRecord }> {
    const dictionary = stream.dictionary;
    const bitsPerCoordinate = await requiredInteger(
      this.document,
      dictionary,
      "BitsPerCoordinate",
      signal
    );
    const bitsPerComponent = await requiredInteger(
      this.document,
      dictionary,
      "BitsPerComponent",
      signal
    );
    if (!VALID_COORDINATE_BITS.has(bitsPerCoordinate)) {
      throw new PdfError("invalid-object", `Invalid mesh /BitsPerCoordinate ${bitsPerCoordinate}.`, {
        details: { feature: "shading", shadingType }
      });
    }
    if (!VALID_COMPONENT_BITS.has(bitsPerComponent)) {
      throw new PdfError("invalid-object", `Invalid mesh /BitsPerComponent ${bitsPerComponent}.`, {
        details: { feature: "shading", shadingType }
      });
    }
    const bitsPerFlag = shadingType === 4
      ? await requiredInteger(this.document, dictionary, "BitsPerFlag", signal)
      : 0;
    if (shadingType === 4 && !VALID_FLAG_BITS.has(bitsPerFlag)) {
      throw new PdfError("invalid-object", `Invalid type 4 mesh /BitsPerFlag ${bitsPerFlag}.`, {
        details: { feature: "shading", shadingType }
      });
    }
    const verticesPerRow = shadingType === 5
      ? await requiredInteger(this.document, dictionary, "VerticesPerRow", signal)
      : 0;
    if (shadingType === 5 && verticesPerRow < 2) {
      throw new PdfError("invalid-object", "A type 5 mesh /VerticesPerRow must be at least 2.", {
        details: { feature: "shading", shadingType }
      });
    }

    const functions = dictionary.has("Function")
      ? await this.parseOptionalMeshFunctions(dictionary, common.colorSpace, signal)
      : { primaryIndex: -1, indices: [] };
    const hasFunction = functions.indices.length > 0;
    if (hasFunction && common.colorSpace.kind === "Indexed") {
      throw shadingError("A mesh shading /Function cannot be used with an Indexed color space.", {
        reason: "indexed-mesh-function",
        shadingType
      });
    }
    if (!hasFunction && common.colorSpace.componentCount > 4) {
      throw shadingError(
        "The HEPR v7 mesh ABI cannot retain more than four direct color components per vertex.",
        {
          reason: "mesh-component-count",
          shadingType,
          componentCount: common.colorSpace.componentCount
        }
      );
    }
    const dataComponentCount = hasFunction ? 1 : common.colorSpace.componentCount;
    const decode = await requiredNumberArray(
      this.document,
      dictionary,
      "Decode",
      4 + dataComponentCount * 2,
      signal
    );
    for (const functionIndex of functions.indices) {
      validateFunctionDomainSuperset(
        this.functions.describe(functionIndex),
        decode.slice(4),
        "Mesh shading /Decode"
      );
    }
    const decodedBytes = await this.document.decodeStream(stream, signal);
    const decoded = decodeMeshVertices(
      decodedBytes,
      bitsPerCoordinate,
      bitsPerComponent,
      bitsPerFlag,
      dataComponentCount,
      decode,
      this.maxMeshVertices,
      shadingType,
      signal
    );
    const indices = shadingType === 4
      ? buildFreeFormTriangles(decoded.flags, signal)
      : buildLatticeTriangles(decoded.positions.length / 2, verticesPerRow, signal);
    if (indices.length > this.maxMeshVertices * 6) {
      throw new PdfError("resource-limit", "A mesh shading exceeds its triangle-index ceiling.", {
        details: {
          feature: "shading",
          shadingType,
          indexCount: indices.length,
          limit: this.maxMeshVertices * 6
        }
      });
    }
    const mesh: MeshRecord = {
      kind: HEPR_MESH_KIND.Triangles,
      positions: freezeNumbers(decoded.positions),
      colors: freezeNumbers(decoded.colors),
      indices: freezeNumbers(indices),
      colorSpaceIndex: common.colorSpaceIndex
    };
    const record = this.makeRecord({
      shadingType,
      kind: shadingType === 4 ? "free-form-mesh" : "lattice-mesh",
      common,
      functionIndex: functions.primaryIndex,
      functionIndices: functions.indices,
      meshIndex: -1,
      coordinates: [],
      domain: [],
      matrix: null,
      extend: EMPTY_EXTEND,
      storeCoordinates: [
        ...(functions.primaryIndex < 0 ? functions.indices : []),
        ...(common.boundingBox ?? []),
        ...(common.background ?? [])
      ]
    });
    return { record, mesh };
  }

  private async parsePatchMeshShading(
    stream: PdfStream,
    common: CommonShadingValues,
    shadingType: 6 | 7,
    signal?: AbortSignal
  ): Promise<{ readonly record: ShadingRecord; readonly mesh: MeshRecord }> {
    const dictionary = stream.dictionary;
    const bitsPerCoordinate = await requiredInteger(
      this.document,
      dictionary,
      "BitsPerCoordinate",
      signal
    );
    const bitsPerComponent = await requiredInteger(
      this.document,
      dictionary,
      "BitsPerComponent",
      signal
    );
    const bitsPerFlag = await requiredInteger(
      this.document,
      dictionary,
      "BitsPerFlag",
      signal
    );
    if (!VALID_COORDINATE_BITS.has(bitsPerCoordinate)) {
      throw new PdfError("invalid-object", `Invalid patch mesh /BitsPerCoordinate ${bitsPerCoordinate}.`, {
        details: { feature: "shading", shadingType }
      });
    }
    if (!VALID_COMPONENT_BITS.has(bitsPerComponent)) {
      throw new PdfError("invalid-object", `Invalid patch mesh /BitsPerComponent ${bitsPerComponent}.`, {
        details: { feature: "shading", shadingType }
      });
    }
    if (!VALID_FLAG_BITS.has(bitsPerFlag)) {
      throw new PdfError("invalid-object", `Invalid patch mesh /BitsPerFlag ${bitsPerFlag}.`, {
        details: { feature: "shading", shadingType }
      });
    }

    const functions = dictionary.has("Function")
      ? await this.parseOptionalMeshFunctions(dictionary, common.colorSpace, signal)
      : { primaryIndex: -1, indices: [] };
    const hasFunction = functions.indices.length > 0;
    if (hasFunction && common.colorSpace.kind === "Indexed") {
      throw shadingError("A patch mesh shading /Function cannot be used with an Indexed color space.", {
        reason: "indexed-mesh-function",
        shadingType
      });
    }
    if (!hasFunction && common.colorSpace.componentCount > 4) {
      throw shadingError(
        "The HEPR v7 mesh ABI cannot retain more than four direct color components per patch corner.",
        {
          reason: "mesh-component-count",
          shadingType,
          componentCount: common.colorSpace.componentCount
        }
      );
    }
    const dataComponentCount = hasFunction ? 1 : common.colorSpace.componentCount;
    const decode = await requiredNumberArray(
      this.document,
      dictionary,
      "Decode",
      4 + dataComponentCount * 2,
      signal
    );
    for (const functionIndex of functions.indices) {
      validateFunctionDomainSuperset(
        this.functions.describe(functionIndex),
        decode.slice(4),
        "Patch mesh shading /Decode"
      );
    }

    const decodedBytes = await this.document.decodeStream(stream, signal);
    const decoded = decodePatchMesh(
      decodedBytes,
      bitsPerCoordinate,
      bitsPerComponent,
      bitsPerFlag,
      dataComponentCount,
      decode,
      this.maxMeshVertices,
      shadingType,
      signal
    );
    const mesh: MeshRecord = {
      kind: shadingType === 6 ? HEPR_MESH_KIND.CoonsPatch : HEPR_MESH_KIND.TensorPatch,
      positions: freezeNumbers(decoded.positions),
      colors: freezeNumbers(decoded.colors),
      indices: freezeNumbers(decoded.indices),
      colorSpaceIndex: common.colorSpaceIndex
    };
    const record = this.makeRecord({
      shadingType,
      kind: shadingType === 6 ? "coons-patch-mesh" : "tensor-patch-mesh",
      common,
      functionIndex: functions.primaryIndex,
      functionIndices: functions.indices,
      meshIndex: -1,
      coordinates: [],
      domain: [],
      matrix: null,
      extend: EMPTY_EXTEND,
      storeCoordinates: [
        ...(functions.primaryIndex < 0 ? functions.indices : []),
        ...(common.boundingBox ?? []),
        ...(common.background ?? [])
      ]
    });
    return { record, mesh };
  }

  private async parseRequiredFunctions(
    dictionary: PdfDictionary,
    inputCount: number,
    outputCount: number,
    shadingDomain: readonly number[],
    signal?: AbortSignal
  ): Promise<ResolvedShadingFunctions> {
    const raw = dictionary.get("Function");
    if (raw === undefined || raw === null) {
      throw new PdfError("invalid-object", "A PDF shading is missing /Function.", {
        details: { feature: "shading" }
      });
    }
    return await this.addFunctions(raw, inputCount, outputCount, shadingDomain, signal);
  }

  private async parseOptionalMeshFunctions(
    dictionary: PdfDictionary,
    colorSpace: Readonly<NativePdfColorSpaceDescription>,
    signal?: AbortSignal
  ): Promise<ResolvedShadingFunctions> {
    const raw = dictionary.get("Function");
    if (raw === undefined || raw === null) return { primaryIndex: -1, indices: [] };
    return await this.addFunctions(raw, 1, colorSpace.componentCount, null, signal);
  }

  private async addFunctions(
    value: PdfValue,
    inputCount: number,
    outputCount: number,
    requiredDomain: readonly number[] | null,
    signal?: AbortSignal
  ): Promise<ResolvedShadingFunctions> {
    const resolved = await this.document.resolveValue(value, signal);
    if (Array.isArray(resolved)) {
      if (resolved.length !== outputCount) {
        throw shadingError("A shading function array has incompatible length.", {
          reason: "shading-function-arity",
          expectedOutputs: outputCount,
          functionCount: resolved.length
        });
      }
      const indices: number[] = [];
      for (const child of resolved) {
        const index = await this.functions.add(child, signal);
        const description = this.functions.describe(index);
        validateFunctionArity(description, inputCount, 1);
        if (requiredDomain) {
          validateFunctionDomainSuperset(description, requiredDomain, "Shading /Domain");
        }
        if (index > 0x0100_0000) {
          throw new PdfError(
            "resource-limit",
            "A shading function-array index exceeds Float32's exact-integer range.",
            { details: { feature: "shading", index, limit: 0x0100_0000 } }
          );
        }
        indices.push(index);
      }
      return { primaryIndex: -1, indices: freezeNumbers(indices) };
    }
    const index = await this.functions.add(value, signal);
    const description = this.functions.describe(index);
    validateFunctionArity(description, inputCount, outputCount);
    if (requiredDomain) {
      validateFunctionDomainSuperset(description, requiredDomain, "Shading /Domain");
    }
    return { primaryIndex: index, indices: Object.freeze([index]) };
  }

  private makeRecord(input: {
    readonly shadingType: NativePdfShadingType;
    readonly kind: NativePdfShadingKind;
    readonly common: CommonShadingValues;
    readonly functionIndex: number;
    readonly functionIndices: readonly number[];
    readonly meshIndex: number;
    readonly coordinates: readonly number[];
    readonly domain: readonly number[];
    readonly matrix: NativePdfShadingMatrix | null;
    readonly extend: readonly [boolean, boolean];
    readonly storeCoordinates: readonly number[];
  }): ShadingRecord {
    assertFloat32Values(input.storeCoordinates, "A shading coordinate payload");
    return {
      shadingType: input.shadingType,
      kind: input.kind,
      colorSpaceIndex: input.common.colorSpaceIndex,
      functionIndex: input.functionIndex,
      functionIndices: freezeNumbers(input.functionIndices),
      meshIndex: input.meshIndex,
      coordinates: freezeNumbers(input.coordinates),
      domain: freezeNumbers(input.domain),
      matrix: input.matrix,
      boundingBox: input.common.boundingBox,
      background: input.common.background,
      extend: input.extend,
      antiAlias: input.common.antiAlias,
      storeCoordinates: freezeNumbers(input.storeCoordinates)
    };
  }

  private getRecord(index: number): ShadingRecord {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.records.length) {
      throw new RangeError(`PDF shading index ${index} is out of range.`);
    }
    return this.records[index];
  }

  private scopeId(resources: PdfDictionary | undefined): number {
    if (!resources) return 0;
    let id = this.scopeIds.get(resources);
    if (id === undefined) {
      id = this.nextScopeId++;
      this.scopeIds.set(resources, id);
    }
    return id;
  }
}

function emptyStack(): ParseStack {
  return { refs: new Set(), objects: new Set(), resourceNames: new Set() };
}

function normalizeName(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function gradientKind(shadingType: NativePdfShadingType): number {
  switch (shadingType) {
    case 1: return HEPR_GRADIENT_KIND.Function;
    case 2: return HEPR_GRADIENT_KIND.Axial;
    case 3: return HEPR_GRADIENT_KIND.Radial;
    case 4: return HEPR_GRADIENT_KIND.FreeFormMesh;
    case 5: return HEPR_GRADIENT_KIND.LatticeMesh;
    case 6: return HEPR_GRADIENT_KIND.CoonsPatchMesh;
    case 7: return HEPR_GRADIENT_KIND.TensorPatchMesh;
  }
}

function encodeStoreFlags(record: Readonly<NativePdfShadingDescription>): number {
  let flags = 0;
  if (record.extend[0]) flags |= NATIVE_PDF_SHADING_STORE_FLAGS.ExtendStart;
  if (record.extend[1]) flags |= NATIVE_PDF_SHADING_STORE_FLAGS.ExtendEnd;
  if (record.antiAlias) flags |= NATIVE_PDF_SHADING_STORE_FLAGS.AntiAlias;
  if (record.boundingBox) flags |= NATIVE_PDF_SHADING_STORE_FLAGS.HasBoundingBox;
  if (record.background) flags |= NATIVE_PDF_SHADING_STORE_FLAGS.HasBackground;
  if (record.functionIndex < 0 && record.functionIndices.length > 0) {
    flags |= NATIVE_PDF_SHADING_STORE_FLAGS.HasFunctionArray;
  }
  return flags;
}

async function optionalResourceDictionary(
  document: NativePdfDocument,
  resources: PdfDictionary | undefined,
  key: string,
  signal?: AbortSignal
): Promise<PdfDictionary | undefined> {
  if (!resources) return undefined;
  const raw = resources.get(key);
  if (raw === undefined || raw === null) return undefined;
  const resolved = await document.resolveValue(raw, signal);
  if (!isPdfDictionary(resolved)) {
    throw new PdfError("invalid-object", `PDF /${key} resources are not a dictionary.`, {
      details: { feature: "shading" }
    });
  }
  return resolved;
}

async function requiredInteger(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  signal?: AbortSignal
): Promise<number> {
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new PdfError("invalid-object", `Shading /${key} must be an integer.`, {
      details: { feature: "shading", key }
    });
  }
  return value;
}

async function requiredNumberArray(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  expectedLength: number,
  signal?: AbortSignal
): Promise<readonly number[]> {
  const raw = await document.resolveValue(dictionary.get(key), signal);
  if (!Array.isArray(raw) || raw.length !== expectedLength) {
    throw new PdfError("invalid-object", `Shading /${key} must contain ${expectedLength} numbers.`, {
      details: { feature: "shading", key, expectedLength }
    });
  }
  const values: number[] = [];
  for (const item of raw) {
    const resolved = await document.resolveValue(item, signal);
    if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
      throw new PdfError("invalid-object", `Shading /${key} contains a non-finite number.`, {
        details: { feature: "shading", key }
      });
    }
    values.push(resolved);
  }
  assertFloat32Values(values, `Shading /${key}`);
  return values;
}

async function optionalBoolean(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  fallback: boolean,
  signal?: AbortSignal
): Promise<boolean> {
  if (!dictionary.has(key)) return fallback;
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (typeof value !== "boolean") {
    throw new PdfError("invalid-object", `Shading /${key} must be boolean.`, {
      details: { feature: "shading", key }
    });
  }
  return value;
}

async function readExtend(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  signal?: AbortSignal
): Promise<readonly [boolean, boolean]> {
  if (!dictionary.has("Extend")) return EMPTY_EXTEND;
  const raw = await document.resolveValue(dictionary.get("Extend"), signal);
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new PdfError("invalid-object", "Shading /Extend must contain two booleans.", {
      details: { feature: "shading", key: "Extend" }
    });
  }
  const first = await document.resolveValue(raw[0], signal);
  const second = await document.resolveValue(raw[1], signal);
  if (typeof first !== "boolean" || typeof second !== "boolean") {
    throw new PdfError("invalid-object", "Shading /Extend must contain two booleans.", {
      details: { feature: "shading", key: "Extend" }
    });
  }
  return Object.freeze([first, second]) as readonly [boolean, boolean];
}

function normalizeRectangle(values: readonly number[]): NativePdfShadingRectangle {
  return Object.freeze([
    Math.min(values[0], values[2]),
    Math.min(values[1], values[3]),
    Math.max(values[0], values[2]),
    Math.max(values[1], values[3])
  ]);
}

function asMatrix(values: readonly number[]): NativePdfShadingMatrix {
  return Object.freeze([values[0], values[1], values[2], values[3], values[4], values[5]]);
}

function validateOrderedIntervals(values: readonly number[], label: string): void {
  for (let index = 0; index < values.length; index += 2) {
    if (!(values[index] < values[index + 1])) {
      throw new PdfError("invalid-object", `${label} intervals must be increasing.`, {
        details: { feature: "shading" }
      });
    }
  }
}

function validateFunctionArity(
  description: Readonly<NativePdfFunctionDescription>,
  inputCount: number,
  outputCount: number
): void {
  if (description.inputCount !== inputCount || description.outputCount !== outputCount) {
    throw shadingError("A shading function has incompatible input or output arity.", {
      reason: "shading-function-arity",
      expectedInputs: inputCount,
      actualInputs: description.inputCount,
      expectedOutputs: outputCount,
      actualOutputs: description.outputCount
    });
  }
}

function validateFunctionDomainSuperset(
  description: Readonly<NativePdfFunctionDescription>,
  requiredDomain: readonly number[],
  label: string
): void {
  if (description.domain.length !== requiredDomain.length) {
    throw shadingError("A shading function domain has incompatible dimensionality.", {
      reason: "shading-function-domain"
    });
  }
  for (let index = 0; index < requiredDomain.length; index += 2) {
    const requiredMin = Math.min(requiredDomain[index], requiredDomain[index + 1]);
    const requiredMax = Math.max(requiredDomain[index], requiredDomain[index + 1]);
    if (description.domain[index] > requiredMin || description.domain[index + 1] < requiredMax) {
      throw shadingError(`A shading function /Domain does not cover ${label}.`, {
        reason: "shading-function-domain",
        inputIndex: index / 2
      });
    }
  }
}

/**
 * Decode PDF type 6/7 records into complete, source-ordered patch control nets.
 * ISO 32000 continuation flags reuse one four-point edge and its two corner
 * values from the immediately preceding patch. Expanding those implicit values
 * here makes HEP self-contained while preserving the original patch geometry.
 */
function decodePatchMesh(
  bytes: Uint8Array,
  bitsPerCoordinate: number,
  bitsPerComponent: number,
  bitsPerFlag: number,
  componentCount: number,
  decode: readonly number[],
  maxControlPoints: number,
  shadingType: 6 | 7,
  signal?: AbortSignal
): DecodedPatchMesh {
  const controlPointCount = shadingType === 6 ? 12 : 16;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const coordinateMaximum = maxEncodedValue(bitsPerCoordinate);
  const componentMaximum = maxEncodedValue(bitsPerComponent);
  const reader = new PatchMeshBitReader(bytes, shadingType, signal);
  let previousPoints: readonly number[] | null = null;
  let previousCorners: readonly number[] | null = null;
  let patchIndex = 0;

  while (!reader.atEnd) {
    throwIfAborted(signal);
    const nextControlPointCount = positions.length / 2 + controlPointCount;
    if (
      !Number.isSafeInteger(nextControlPointCount) ||
      nextControlPointCount > maxControlPoints ||
      nextControlPointCount > 0xffff_ffff
    ) {
      throw new PdfError("resource-limit", "A patch mesh shading exceeds its control-point ceiling.", {
        details: {
          feature: "shading",
          shadingType,
          controlPointCount: nextControlPointCount,
          limit: Math.min(maxControlPoints, 0xffff_ffff)
        }
      });
    }

    const flag = reader.read(bitsPerFlag, "edge flag") & 3;
    if (patchIndex === 0 && flag !== 0) {
      throw new PdfError("invalid-object", "The first patch mesh record must have edge flag 0.", {
        details: { feature: "shading", shadingType, patchIndex, flag }
      });
    }
    if (flag !== 0 && (!previousPoints || !previousCorners)) {
      throw new PdfError("invalid-object", "A patch continuation has no preceding patch.", {
        details: { feature: "shading", shadingType, patchIndex, flag }
      });
    }

    const points = new Array<number>(controlPointCount * 2).fill(0);
    const corners = new Array<number>(16).fill(0);
    if (flag !== 0) {
      const sharedPoints = patchSharedPointIndices(flag);
      const sharedCorners = patchSharedCornerIndices(flag);
      for (let point = 0; point < 4; point += 1) {
        const source = sharedPoints[point] * 2;
        points[point * 2] = previousPoints![source];
        points[point * 2 + 1] = previousPoints![source + 1];
      }
      for (let corner = 0; corner < 2; corner += 1) {
        const source = sharedCorners[corner] * 4;
        for (let component = 0; component < 4; component += 1) {
          corners[corner * 4 + component] = previousCorners![source + component];
        }
      }
    }

    const firstExplicitPoint = flag === 0 ? 0 : 4;
    for (let point = firstExplicitPoint; point < controlPointCount; point += 1) {
      points[point * 2] = mapEncoded(
        reader.read(bitsPerCoordinate, "x coordinate"),
        coordinateMaximum,
        decode[0],
        decode[1]
      );
      points[point * 2 + 1] = mapEncoded(
        reader.read(bitsPerCoordinate, "y coordinate"),
        coordinateMaximum,
        decode[2],
        decode[3]
      );
    }

    const firstExplicitCorner = flag === 0 ? 0 : 2;
    for (let corner = firstExplicitCorner; corner < 4; corner += 1) {
      for (let component = 0; component < componentCount; component += 1) {
        corners[corner * 4 + component] = mapEncoded(
          reader.read(bitsPerComponent, "corner component"),
          componentMaximum,
          decode[4 + component * 2],
          decode[5 + component * 2]
        );
      }
    }
    reader.alignPatchRecord();

    const controlPointBase = positions.length / 2;
    positions.push(...points);
    const patchColorSlots = new Array<number>(controlPointCount * 4).fill(0);
    for (let corner = 0; corner < 4; corner += 1) {
      const target = PATCH_CORNER_POINT_INDICES[corner] * 4;
      for (let component = 0; component < 4; component += 1) {
        patchColorSlots[target + component] = corners[corner * 4 + component];
      }
    }
    colors.push(...patchColorSlots);
    for (let point = 0; point < controlPointCount; point += 1) {
      indices.push(controlPointBase + point);
    }
    previousPoints = points;
    previousCorners = corners;
    patchIndex += 1;
  }

  if (patchIndex === 0) {
    throw new PdfError("invalid-object", "A patch mesh shading must contain at least one complete patch.", {
      details: { feature: "shading", shadingType }
    });
  }
  assertFloat32Values(positions, "A decoded patch control point");
  assertFloat32Values(colors, "A decoded patch corner payload");
  return { positions, colors, indices };
}

const PATCH_CORNER_POINT_INDICES = Object.freeze([0, 3, 6, 9]);

function patchSharedPointIndices(flag: number): readonly number[] {
  switch (flag) {
    case 1: return [3, 4, 5, 6];
    case 2: return [6, 7, 8, 9];
    case 3: return [9, 10, 11, 0];
    default:
      throw new RangeError(`Invalid patch continuation flag ${flag}.`);
  }
}

function patchSharedCornerIndices(flag: number): readonly number[] {
  switch (flag) {
    case 1: return [1, 2];
    case 2: return [2, 3];
    case 3: return [3, 0];
    default:
      throw new RangeError(`Invalid patch continuation flag ${flag}.`);
  }
}

class PatchMeshBitReader {
  private readonly bytes: Uint8Array;
  private readonly shadingType: 6 | 7;
  private readonly signal?: AbortSignal;
  private bitOffset = 0;
  private readCount = 0;

  constructor(bytes: Uint8Array, shadingType: 6 | 7, signal?: AbortSignal) {
    this.bytes = bytes;
    this.shadingType = shadingType;
    this.signal = signal;
  }

  get atEnd(): boolean {
    return this.bitOffset === this.bytes.length * 8;
  }

  read(bitCount: number, label: string): number {
    const end = this.bitOffset + bitCount;
    if (!Number.isSafeInteger(end) || bitCount <= 0 || end > this.bytes.length * 8) {
      throw new PdfError("invalid-object", `A patch mesh ends within its ${label}.`, {
        offset: Math.floor(this.bitOffset / 8),
        details: { feature: "shading", shadingType: this.shadingType, bitOffset: this.bitOffset }
      });
    }
    let value = 0;
    let remaining = bitCount;
    while (remaining > 0) {
      const byteIndex = Math.floor(this.bitOffset / 8);
      const withinByte = this.bitOffset & 7;
      const take = Math.min(remaining, 8 - withinByte);
      const shift = 8 - withinByte - take;
      const mask = 2 ** take - 1;
      value = value * 2 ** take + ((this.bytes[byteIndex] >>> shift) & mask);
      this.bitOffset += take;
      remaining -= take;
    }
    this.readCount += 1;
    if ((this.readCount & 0x0fff) === 0) throwIfAborted(this.signal);
    return value;
  }

  alignPatchRecord(): void {
    const aligned = Math.ceil(this.bitOffset / 8) * 8;
    if (aligned > this.bytes.length * 8) {
      throw new PdfError("invalid-object", "A patch mesh ends within record padding.", {
        offset: Math.floor(this.bitOffset / 8),
        details: { feature: "shading", shadingType: this.shadingType }
      });
    }
    // ISO 32000 defines inter-record pad bits as ignored; do not require zero.
    this.bitOffset = aligned;
    throwIfAborted(this.signal);
  }
}

function decodeMeshVertices(
  bytes: Uint8Array,
  bitsPerCoordinate: number,
  bitsPerComponent: number,
  bitsPerFlag: number,
  componentCount: number,
  decode: readonly number[],
  maxVertices: number,
  shadingType: 4 | 5,
  signal?: AbortSignal
): DecodedMesh {
  const meaningfulBits = bitsPerFlag + bitsPerCoordinate * 2 + bitsPerComponent * componentCount;
  const strideBytes = Math.ceil(meaningfulBits / 8);
  if (strideBytes <= 0 || bytes.length % strideBytes !== 0) {
    throw new PdfError("invalid-object", "A mesh shading stream ends within a vertex record.", {
      details: { feature: "shading", shadingType, strideBytes, byteLength: bytes.length }
    });
  }
  const vertexCount = bytes.length / strideBytes;
  if (vertexCount > maxVertices) {
    throw new PdfError("resource-limit", "A mesh shading exceeds its vertex ceiling.", {
      details: { feature: "shading", shadingType, vertexCount, limit: maxVertices }
    });
  }
  const positions: number[] = [];
  const colors: number[] = [];
  const flags: number[] = [];
  const coordinateMax = maxEncodedValue(bitsPerCoordinate);
  const componentMax = maxEncodedValue(bitsPerComponent);

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    if ((vertex & 0x0fff) === 0) throwIfAborted(signal);
    const reader = new FixedRecordBitReader(bytes, vertex * strideBytes, strideBytes);
    flags.push(bitsPerFlag === 0 ? 0 : reader.read(bitsPerFlag) & 3);
    positions.push(
      mapEncoded(reader.read(bitsPerCoordinate), coordinateMax, decode[0], decode[1]),
      mapEncoded(reader.read(bitsPerCoordinate), coordinateMax, decode[2], decode[3])
    );
    for (let component = 0; component < componentCount; component += 1) {
      colors.push(mapEncoded(
        reader.read(bitsPerComponent),
        componentMax,
        decode[4 + component * 2],
        decode[5 + component * 2]
      ));
    }
    for (let component = componentCount; component < 4; component += 1) colors.push(0);
  }
  assertFloat32Values(positions, "A decoded mesh position");
  assertFloat32Values(colors, "A decoded mesh color");
  return { positions, colors, flags };
}

function buildFreeFormTriangles(
  flags: readonly number[],
  signal?: AbortSignal
): readonly number[] {
  const indices: number[] = [];
  let previous: readonly [number, number, number] | null = null;
  let vertex = 0;
  while (vertex < flags.length) {
    if ((vertex & 0x0fff) === 0) throwIfAborted(signal);
    const flag = flags[vertex];
    if (flag === 0) {
      if (vertex + 2 >= flags.length) {
        throw new PdfError("invalid-object", "A type 4 mesh ends before a new triangle is complete.", {
          details: { feature: "shading", shadingType: 4, vertex }
        });
      }
      previous = [vertex, vertex + 1, vertex + 2];
      indices.push(...previous);
      vertex += 3;
      continue;
    }
    if (!previous || (flag !== 1 && flag !== 2)) {
      throw new PdfError("invalid-object", `Invalid type 4 mesh edge flag ${flag}.`, {
        details: { feature: "shading", shadingType: 4, vertex, flag }
      });
    }
    previous = flag === 1
      ? [previous[1], previous[2], vertex]
      : [previous[0], previous[2], vertex];
    indices.push(...previous);
    vertex += 1;
  }
  return indices;
}

function buildLatticeTriangles(
  vertexCount: number,
  verticesPerRow: number,
  signal?: AbortSignal
): readonly number[] {
  if (vertexCount % verticesPerRow !== 0) {
    throw new PdfError("invalid-object", "A type 5 mesh stream does not contain complete rows.", {
      details: { feature: "shading", shadingType: 5, vertexCount, verticesPerRow }
    });
  }
  const rows = vertexCount / verticesPerRow;
  if (rows < 2) {
    throw new PdfError("invalid-object", "A type 5 mesh must contain at least two complete rows.", {
      details: { feature: "shading", shadingType: 5, rows, verticesPerRow }
    });
  }
  const indices: number[] = [];
  for (let row = 0; row + 1 < rows; row += 1) {
    if ((row & 0x03ff) === 0) throwIfAborted(signal);
    for (let column = 0; column + 1 < verticesPerRow; column += 1) {
      const topLeft = row * verticesPerRow + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + verticesPerRow;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, topRight, bottomLeft, topRight, bottomLeft, bottomRight);
    }
  }
  return indices;
}

class FixedRecordBitReader {
  private readonly bytes: Uint8Array;
  private readonly endBit: number;
  private bitOffset: number;

  constructor(bytes: Uint8Array, byteOffset: number, byteLength: number) {
    this.bytes = bytes;
    this.bitOffset = byteOffset * 8;
    this.endBit = (byteOffset + byteLength) * 8;
  }

  read(bitCount: number): number {
    if (bitCount < 0 || this.bitOffset + bitCount > this.endBit) {
      throw new PdfError("invalid-object", "A mesh shading vertex record is truncated.", {
        details: { feature: "shading" }
      });
    }
    let result = 0;
    let remaining = bitCount;
    while (remaining > 0) {
      const byteIndex = Math.floor(this.bitOffset / 8);
      const withinByte = this.bitOffset % 8;
      const take = Math.min(remaining, 8 - withinByte);
      const shift = 8 - withinByte - take;
      const mask = (1 << take) - 1;
      result = result * 2 ** take + ((this.bytes[byteIndex] >>> shift) & mask);
      this.bitOffset += take;
      remaining -= take;
    }
    return result;
  }
}

function maxEncodedValue(bits: number): number {
  return bits === 32 ? 0xffff_ffff : 2 ** bits - 1;
}

function mapEncoded(value: number, maximum: number, minimum: number, maximumValue: number): number {
  return minimum + (value / maximum) * (maximumValue - minimum);
}

function assertFloat32Values(values: readonly number[], label: string): void {
  for (const value of values) {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
      throw shadingError(`${label} cannot be represented by the HEPR Float32 ABI.`, {
        reason: "shading-float32-range"
      });
    }
  }
}

function freezeNumbers(values: readonly number[]): readonly number[] {
  return Object.freeze([...values]);
}

function shadingError(
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {}
): PdfError {
  return new PdfError("unsupported-content", message, {
    details: { feature: "shading", ...details }
  });
}
