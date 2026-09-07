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
import type { NativePdfDocument } from "./nativeDocument";
import {
  NativePdfShadingRegistry,
  type NativePdfShadingDescription
} from "./nativeShadings";
import { PdfError, throwIfAborted } from "./nativeTypes";
import {
  HEPR_PATTERN_KIND,
  type HeprPatternStore
} from "../heprDocumentData";

export type NativePdfPatternType = 1 | 2;
export type NativePdfPatternKind = "colored-tiling" | "uncolored-tiling" | "shading";
export type NativePdfPatternPaintType = 1 | 2;
export type NativePdfPatternTilingType = 1 | 2 | 3;
export type NativePdfPatternResourceOrigin = "local" | "inherited" | "empty";
export type NativePdfPatternRectangle = readonly [number, number, number, number];
export type NativePdfPatternMatrix = readonly [number, number, number, number, number, number];

interface NativePdfPatternCommon {
  /** Registry-local stable index used by pattern commands and sidecars. */
  readonly index: number;
  /** Source plus effective-resource identity. */
  readonly id: string;
  readonly ref: PdfRef | null;
  readonly dictionary: PdfDictionary;
  readonly patternType: NativePdfPatternType;
  readonly kind: NativePdfPatternKind;
  readonly matrix: NativePdfPatternMatrix;
  readonly resources: PdfDictionary;
  readonly resourceOrigin: NativePdfPatternResourceOrigin;
}

export interface NativePdfTilingPatternDescription extends NativePdfPatternCommon {
  readonly patternType: 1;
  readonly kind: "colored-tiling" | "uncolored-tiling";
  readonly paintType: NativePdfPatternPaintType;
  readonly tilingType: NativePdfPatternTilingType;
  readonly boundingBox: NativePdfPatternRectangle;
  readonly xStep: number;
  readonly yStep: number;
  readonly encodedContentBytes: number;
}

export interface NativePdfShadingPatternDescription extends NativePdfPatternCommon {
  readonly patternType: 2;
  readonly kind: "shading";
  readonly shadingIndex: number;
  readonly shading: Readonly<NativePdfShadingDescription>;
  /** Retained for the later graphics-state/group compiler. */
  readonly extGState: Readonly<PdfDictionary> | null;
}

export type NativePdfPatternDescription =
  | NativePdfTilingPatternDescription
  | NativePdfShadingPatternDescription;

type NativePdfPatternDraft =
  | Omit<NativePdfTilingPatternDescription, "index">
  | Omit<NativePdfShadingPatternDescription, "index">;

/** Invocation ancestry is intentionally separate from reusable definitions. */
export interface NativePdfPatternInvocation {
  readonly pattern: Readonly<NativePdfPatternDescription>;
  readonly depth: number;
  readonly ancestry: readonly string[];
}

export interface NativePdfPatternOptions {
  /** May lower, but never raise, the document recursion ceiling. */
  readonly maxPatternDepth?: number;
  /** Maximum definitions retained by this registry. */
  readonly maxPatterns?: number;
  /** Per-pattern decoded content limit. */
  readonly maxDecodedPatternBytes?: number;
  /** Total decoded tiling content retained by this registry. */
  readonly maxCachedDecodedPatternBytes?: number;
}

/**
 * Standalone sidecars for reusable-program compilation.
 *
 * `patterns.matrixIndices` address the local six-float `matrices` array.
 * Tiling `programIndices` deliberately remain -1 until their decoded content
 * has been compiled into reusable display programs. Uncolored-pattern base
 * color spaces remain -1 until the paint invocation binds one. Shading
 * patterns already reference `NativePdfShadingRegistry` indexes through
 * `gradientIndices`.
 */
export interface NativePdfPatternSidecars {
  readonly patterns: HeprPatternStore;
  /** Six floats per local pattern matrix. */
  readonly matrices: Float32Array;
  /** One span per pattern; shading-pattern spans are empty. */
  readonly contentOffsets: Uint32Array;
  readonly decodedContent: Uint8Array;
  readonly encodedContentBytes: Uint32Array;
  /** 0 = empty, 1 = inherited, 2 = local. */
  readonly resourceOrigins: Uint8Array;
  readonly patternIds: readonly string[];
  /** Consumed by compositing-state compilation before HEP serialization. */
  readonly extGStates: readonly (Readonly<PdfDictionary> | null)[];
}

interface PatternRecord {
  readonly pattern: Readonly<NativePdfPatternDescription>;
  readonly stream: PdfStream | null;
  readonly semanticIdentity: string;
}

interface EffectiveResourceScope {
  readonly dictionary: PdfDictionary;
  readonly origin: NativePdfPatternResourceOrigin;
  readonly identity: string;
}

interface ResolutionStack {
  readonly refs: ReadonlySet<string>;
  readonly resourceNames: ReadonlySet<string>;
}

const IDENTITY_MATRIX: NativePdfPatternMatrix = Object.freeze([1, 0, 0, 1, 0, 0]);
const EMPTY_RESOURCES: PdfDictionary = new Map();
const MAX_UINT32 = 0xffff_ffff;
const MAX_INT32 = 0x7fff_ffff;

/**
 * Lazy native registry for PDF tiling and shading patterns.
 *
 * It performs structural validation and resource resolution only. Tiling
 * streams remain vector content and are decoded lazily for the normal content
 * compiler; this registry never rasterizes a pattern cell.
 */
export class NativePdfPatternRegistry {
  readonly document: NativePdfDocument;
  readonly shadings: NativePdfShadingRegistry;

  private readonly maxPatternDepth: number;
  private readonly maxPatterns: number;
  private readonly maxDecodedPatternBytes: number;
  private readonly maxCachedDecodedPatternBytes: number;
  private readonly records: PatternRecord[] = [];
  private readonly recordCache = new Map<string, Promise<PatternRecord>>();
  private readonly resourceCache = new WeakMap<PdfDictionary, Map<string, Promise<PatternRecord>>>();
  private readonly pageResourceCache = new Map<number, PdfDictionary>();
  private readonly recordByDescription = new WeakMap<object, PatternRecord>();
  private readonly decodedContentCache = new WeakMap<PatternRecord, Promise<Uint8Array>>();
  private readonly objectIds = new WeakMap<object, number>();
  private nextObjectId = 1;
  private cachedDecodedBytes = 0;

  constructor(
    document: NativePdfDocument,
    shadings?: NativePdfShadingRegistry,
    options: NativePdfPatternOptions = {}
  ) {
    if (shadings && shadings.document !== document) {
      throw new TypeError("A pattern registry and its shading registry must use the same PDF document.");
    }
    this.document = document;
    this.shadings = shadings ?? new NativePdfShadingRegistry(document);
    this.maxPatternDepth = boundedOption(
      options.maxPatternDepth,
      document.limits.maxRecursionDepth,
      "maxPatternDepth"
    );
    this.maxPatterns = boundedOption(
      options.maxPatterns,
      document.limits.maxPathsPerPage,
      "maxPatterns"
    );
    this.maxDecodedPatternBytes = boundedOption(
      options.maxDecodedPatternBytes,
      document.limits.maxDecodedStreamBytes,
      "maxDecodedPatternBytes"
    );
    this.maxCachedDecodedPatternBytes = boundedOption(
      options.maxCachedDecodedPatternBytes,
      document.limits.maxDecodedStreamBytes,
      "maxCachedDecodedPatternBytes"
    );
  }

  get size(): number {
    return this.records.length;
  }

  get patternDepthLimit(): number {
    return this.maxPatternDepth;
  }

  /** Resolve one pattern name from a page's inherited resource dictionary. */
  async resolvePagePattern(
    pageIndex: number,
    resourceName: string,
    signal?: AbortSignal
  ): Promise<NativePdfPatternInvocation> {
    throwIfAborted(signal);
    const resources = await this.getPageResources(pageIndex, signal);
    const record = await this.resolveNamedPattern(
      resources,
      resourceName,
      resources,
      emptyStack(),
      `page ${pageIndex}`,
      signal
    );
    return this.createRootInvocation(record);
  }

  /**
   * Resolve a pattern used inside a tiling pattern while enforcing invocation
   * depth and recursion independently from definition caching.
   */
  async resolveNestedPattern(
    parent: NativePdfPatternInvocation,
    resourceName: string,
    signal?: AbortSignal
  ): Promise<NativePdfPatternInvocation> {
    throwIfAborted(signal);
    this.recordForDescription(parent.pattern);
    if (parent.pattern.patternType !== 1) {
      throw patternError("A shading pattern cannot contain a nested pattern program.", {
        reason: "nested-pattern-owner-not-tiling"
      });
    }
    if (parent.depth >= this.maxPatternDepth) {
      throw new PdfError(
        "resource-limit",
        `Pattern invocation exceeds the configured depth limit of ${this.maxPatternDepth}.`,
        { details: { feature: "pattern", reason: "pattern-depth", maxPatternDepth: this.maxPatternDepth } }
      );
    }
    const record = await this.resolveNamedPattern(
      parent.pattern.resources,
      resourceName,
      parent.pattern.resources,
      emptyStack(),
      `pattern ${parent.pattern.id}`,
      signal
    );
    if (parent.ancestry.includes(record.semanticIdentity)) {
      throw patternError(`Pattern ${record.pattern.id} participates in an invocation cycle.`, {
        reason: "pattern-cycle",
        patternId: record.pattern.id
      });
    }
    return Object.freeze({
      pattern: record.pattern,
      depth: parent.depth + 1,
      ancestry: Object.freeze([...parent.ancestry, record.semanticIdentity])
    });
  }

  /** Add a direct/ref pattern using an optional enclosing resource scope. */
  async add(
    value: PdfValue,
    resources?: PdfDictionary,
    signal?: AbortSignal
  ): Promise<number> {
    const record = await this.loadPattern(value, resources, emptyStack(), "direct pattern", signal);
    return record.pattern.index;
  }

  createInvocation(index: number): NativePdfPatternInvocation {
    return this.createRootInvocation(this.getRecord(index));
  }

  describe(index: number): Readonly<NativePdfPatternDescription> {
    return this.getRecord(index).pattern;
  }

  /** Decode and cache a tiling pattern's complete filter chain. */
  async decodeTilingContent(index: number, signal?: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal);
    const record = this.getRecord(index);
    if (record.pattern.patternType !== 1 || !record.stream) {
      throw new TypeError(`PDF pattern ${index} is not a tiling-pattern stream.`);
    }
    const cached = this.decodedContentCache.get(record);
    if (cached) return await cached;
    const pending = this.document.decodeStream(record.stream, signal)
      .then((bytes) => {
        throwIfAborted(signal);
        if (bytes.byteLength > this.maxDecodedPatternBytes) {
          throw new PdfError(
            "resource-limit",
            `Decoded tiling pattern ${index} exceeds ${this.maxDecodedPatternBytes} bytes.`,
            {
              details: {
                feature: "pattern",
                reason: "pattern-decoded-bytes",
                patternIndex: index,
                byteLength: bytes.byteLength,
                limit: this.maxDecodedPatternBytes
              }
            }
          );
        }
        if (this.cachedDecodedBytes + bytes.byteLength > this.maxCachedDecodedPatternBytes) {
          throw new PdfError(
            "resource-limit",
            "Decoded tiling-pattern cache exceeds its configured byte limit.",
            {
              details: {
                feature: "pattern",
                reason: "pattern-cache-bytes",
                byteLength: this.cachedDecodedBytes + bytes.byteLength,
                limit: this.maxCachedDecodedPatternBytes
              }
            }
          );
        }
        this.cachedDecodedBytes += bytes.byteLength;
        return bytes;
      })
      .catch((error) => {
        this.decodedContentCache.delete(record);
        throw error;
      });
    this.decodedContentCache.set(record, pending);
    return await pending;
  }

  /** Build deterministic typed-array sidecars in registry-index order. */
  async buildSidecars(signal?: AbortSignal): Promise<NativePdfPatternSidecars> {
    throwIfAborted(signal);
    const count = this.records.length;
    const kinds = new Uint8Array(count);
    const paintTypes = new Uint8Array(count);
    const tilingTypes = new Uint8Array(count);
    const bounds = new Float32Array(count * 4);
    const xSteps = new Float32Array(count);
    const ySteps = new Float32Array(count);
    const matrixIndices = new Uint32Array(count);
    const programIndices = new Int32Array(count);
    const gradientIndices = new Int32Array(count);
    const underlyingColorSpaceIndices = new Int32Array(count);
    const matrices = new Float32Array(count * 6);
    const encodedContentBytes = new Uint32Array(count);
    const resourceOrigins = new Uint8Array(count);
    const contentOffsets = new Uint32Array(count + 1);
    const contentChunks: Uint8Array[] = [];
    const patternIds: string[] = [];
    const extGStates: (Readonly<PdfDictionary> | null)[] = [];
    let contentLength = 0;

    programIndices.fill(-1);
    gradientIndices.fill(-1);
    underlyingColorSpaceIndices.fill(-1);

    for (let index = 0; index < count; index += 1) {
      throwIfAborted(signal);
      const record = this.records[index];
      const pattern = record.pattern;
      matrixIndices[index] = index;
      matrices.set(pattern.matrix, index * 6);
      resourceOrigins[index] = resourceOriginCode(pattern.resourceOrigin);
      patternIds.push(pattern.id);

      if (pattern.patternType === 1) {
        kinds[index] = pattern.paintType === 1
          ? HEPR_PATTERN_KIND.ColoredTiling
          : HEPR_PATTERN_KIND.UncoloredTiling;
        paintTypes[index] = pattern.paintType;
        tilingTypes[index] = pattern.tilingType;
        bounds.set(pattern.boundingBox, index * 4);
        xSteps[index] = pattern.xStep;
        ySteps[index] = pattern.yStep;
        encodedContentBytes[index] = pattern.encodedContentBytes;
        const decoded = await this.decodeTilingContent(index, signal);
        if (contentLength + decoded.byteLength > MAX_UINT32) {
          throw new PdfError("resource-limit", "Tiling-pattern sidecar exceeds the Uint32 offset ABI.", {
            details: { feature: "pattern", reason: "pattern-sidecar-bytes" }
          });
        }
        contentChunks.push(decoded);
        contentLength += decoded.byteLength;
        extGStates.push(null);
      } else {
        kinds[index] = HEPR_PATTERN_KIND.Shading;
        gradientIndices[index] = pattern.shadingIndex;
        extGStates.push(pattern.extGState);
      }
      contentOffsets[index + 1] = contentLength;
    }

    const decodedContent = new Uint8Array(contentLength);
    let contentOffset = 0;
    for (const chunk of contentChunks) {
      decodedContent.set(chunk, contentOffset);
      contentOffset += chunk.byteLength;
    }
    const patterns: HeprPatternStore = {
      kinds,
      paintTypes,
      tilingTypes,
      bounds,
      xSteps,
      ySteps,
      matrixIndices,
      programIndices,
      gradientIndices,
      underlyingColorSpaceIndices
    };
    return Object.freeze({
      patterns,
      matrices,
      contentOffsets,
      decodedContent,
      encodedContentBytes,
      resourceOrigins,
      patternIds: Object.freeze(patternIds),
      extGStates: Object.freeze(extGStates)
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

  private async resolveNamedPattern(
    resources: PdfDictionary,
    rawName: string,
    inheritedResources: PdfDictionary,
    stack: ResolutionStack,
    ownerLabel: string,
    signal?: AbortSignal
  ): Promise<PatternRecord> {
    throwIfAborted(signal);
    const name = normalizeResourceName(rawName);
    const resourceIdentity = `${this.objectIdentity(resources)}:${name}`;
    if (stack.resourceNames.has(resourceIdentity)) {
      throw patternError(`Pattern resource /${name} is recursive.`, {
        reason: "pattern-resource-cycle",
        resourceName: name
      });
    }
    const rawPatterns = resources.get("Pattern");
    if (rawPatterns === undefined || rawPatterns === null) {
      throw patternError(`${ownerLabel} has no /Pattern resources for /${name}.`, {
        reason: "missing-pattern-resources",
        resourceName: name
      });
    }
    const patterns = await this.document.resolveDictionary(rawPatterns, signal);
    let scopeCache = this.resourceCache.get(resources);
    if (!scopeCache) {
      scopeCache = new Map();
      this.resourceCache.set(resources, scopeCache);
    }
    const cached = scopeCache.get(name);
    if (cached) return await cached;
    const rawPattern = patterns.get(name);
    if (rawPattern === undefined || rawPattern === null) {
      throw patternError(`${ownerLabel} references missing pattern /${name}.`, {
        reason: "missing-pattern-resource",
        resourceName: name
      });
    }
    const resourceNames = new Set(stack.resourceNames);
    resourceNames.add(resourceIdentity);
    const pending = this.loadPattern(
      rawPattern,
      inheritedResources,
      { ...stack, resourceNames },
      `/${name}`,
      signal
    ).catch((error) => {
      scopeCache!.delete(name);
      throw error;
    });
    scopeCache.set(name, pending);
    return await pending;
  }

  private async loadPattern(
    value: PdfValue,
    inheritedResources: PdfDictionary | undefined,
    stack: ResolutionStack,
    label: string,
    signal?: AbortSignal,
    sourceRef: PdfRef | null = null
  ): Promise<PatternRecord> {
    throwIfAborted(signal);
    if (isPdfRef(value)) {
      const identity = pdfRefKey(value);
      if (stack.refs.has(identity)) {
        throw patternError("A PDF pattern reference graph contains a cycle.", {
          reason: "pattern-reference-cycle",
          objectNumber: value.objectNumber
        });
      }
      const refs = new Set(stack.refs);
      refs.add(identity);
      const resolved = await this.document.resolveObject(value, signal);
      return await this.loadPattern(
        resolved,
        inheritedResources,
        { ...stack, refs },
        label,
        signal,
        sourceRef ?? value
      );
    }
    if (isPdfName(value)) {
      if (!inheritedResources) {
        throw patternError(`Pattern name /${value.value} has no resource scope.`, {
          reason: "missing-pattern-resource-scope",
          resourceName: value.value
        });
      }
      return await this.resolveNamedPattern(
        inheritedResources,
        value.value,
        inheritedResources,
        stack,
        label,
        signal
      );
    }
    if (!isPdfDictionary(value) && !isPdfStream(value)) {
      throw new PdfError("invalid-object", `${label} is not a PDF pattern dictionary or stream.`, {
        details: { feature: "pattern" }
      });
    }
    const dictionary = isPdfStream(value) ? value.dictionary : value;
    await this.validatePatternMarker(dictionary, label, signal);
    const patternType = await requiredInteger(
      this.document,
      dictionary.get("PatternType"),
      `${label} /PatternType`,
      signal
    );
    if (patternType !== 1 && patternType !== 2) {
      throw patternError(`Unsupported PDF PatternType ${patternType}.`, {
        reason: "unsupported-pattern-type",
        patternType
      });
    }
    const resources = await this.resolvePatternResources(
      dictionary,
      inheritedResources,
      label,
      signal
    );
    const sourceIdentity = sourceRef
      ? `ref:${pdfRefKey(sourceRef)}`
      : `direct:${this.objectIdentity(value)}`;
    const semanticIdentity = `${sourceIdentity}|resources:${resources.identity}`;
    const cached = this.recordCache.get(semanticIdentity);
    if (cached) return await cached;
    const pending = this.parseAndAppend(
      value,
      sourceRef,
      patternType,
      resources,
      semanticIdentity,
      label,
      signal
    ).catch((error) => {
      this.recordCache.delete(semanticIdentity);
      throw error;
    });
    this.recordCache.set(semanticIdentity, pending);
    return await pending;
  }

  private async parseAndAppend(
    value: PdfDictionary | PdfStream,
    sourceRef: PdfRef | null,
    patternType: NativePdfPatternType,
    resources: EffectiveResourceScope,
    semanticIdentity: string,
    label: string,
    signal?: AbortSignal
  ): Promise<PatternRecord> {
    const stream = isPdfStream(value) ? value : null;
    const dictionary: PdfDictionary = isPdfStream(value) ? value.dictionary : value;
    const matrix = dictionary.has("Matrix")
      ? asMatrix(await requiredNumberArray(
          this.document,
          dictionary.get("Matrix"),
          6,
          `${label} /Matrix`,
          signal
        ))
      : IDENTITY_MATRIX;

    let draft: NativePdfPatternDraft;
    if (patternType === 1) {
      if (!stream) {
        throw new PdfError("invalid-object", `${label} PatternType 1 must be a stream.`, {
          details: { feature: "pattern", reason: "tiling-pattern-not-stream" }
        });
      }
      if (stream.bytes.byteLength > MAX_UINT32) {
        throw new PdfError("resource-limit", `${label} encoded pattern stream exceeds the sidecar ABI.`, {
          details: {
            feature: "pattern",
            reason: "pattern-encoded-bytes",
            byteLength: stream.bytes.byteLength
          }
        });
      }
      const paintType = await requiredInteger(
        this.document,
        dictionary.get("PaintType"),
        `${label} /PaintType`,
        signal
      );
      if (paintType !== 1 && paintType !== 2) {
        throw new PdfError("invalid-object", `${label} /PaintType must be 1 or 2.`, {
          details: { feature: "pattern", reason: "invalid-pattern-paint-type", paintType }
        });
      }
      const tilingType = await requiredInteger(
        this.document,
        dictionary.get("TilingType"),
        `${label} /TilingType`,
        signal
      );
      if (tilingType !== 1 && tilingType !== 2 && tilingType !== 3) {
        throw new PdfError("invalid-object", `${label} /TilingType must be 1, 2, or 3.`, {
          details: { feature: "pattern", reason: "invalid-pattern-tiling-type", tilingType }
        });
      }
      const boundingBox = normalizeRectangle(await requiredNumberArray(
        this.document,
        dictionary.get("BBox"),
        4,
        `${label} /BBox`,
        signal
      ));
      if (!(boundingBox[0] < boundingBox[2]) || !(boundingBox[1] < boundingBox[3])) {
        throw new PdfError("invalid-object", `${label} /BBox must have positive area.`, {
          details: { feature: "pattern", reason: "degenerate-pattern-bbox" }
        });
      }
      const xStep = await requiredNumber(
        this.document,
        dictionary.get("XStep"),
        `${label} /XStep`,
        signal
      );
      const yStep = await requiredNumber(
        this.document,
        dictionary.get("YStep"),
        `${label} /YStep`,
        signal
      );
      if (xStep === 0 || yStep === 0) {
        throw new PdfError("invalid-object", `${label} /XStep and /YStep must be nonzero.`, {
          details: { feature: "pattern", reason: "zero-pattern-step" }
        });
      }
      draft = {
        id: semanticIdentity,
        ref: sourceRef,
        dictionary,
        patternType: 1,
        kind: paintType === 1 ? "colored-tiling" : "uncolored-tiling",
        matrix,
        resources: resources.dictionary,
        resourceOrigin: resources.origin,
        paintType,
        tilingType,
        boundingBox,
        xStep,
        yStep,
        encodedContentBytes: stream.bytes.byteLength
      };
    } else {
      if (stream) {
        throw new PdfError("invalid-object", `${label} PatternType 2 must be a dictionary.`, {
          details: { feature: "pattern", reason: "shading-pattern-is-stream" }
        });
      }
      const rawShading = dictionary.get("Shading");
      if (rawShading === undefined || rawShading === null) {
        throw new PdfError("invalid-object", `${label} shading pattern is missing /Shading.`, {
          details: { feature: "pattern", reason: "missing-pattern-shading" }
        });
      }
      const shadingIndex = await this.shadings.add(rawShading, resources.dictionary, signal);
      if (shadingIndex > MAX_INT32) {
        throw new PdfError("resource-limit", "A shading-pattern index exceeds the HEPR v7 ABI.", {
          details: { feature: "pattern", reason: "pattern-shading-index" }
        });
      }
      const extGState = dictionary.has("ExtGState")
        ? await this.resolveExtGState(dictionary.get("ExtGState"), label, signal)
        : null;
      draft = {
        id: semanticIdentity,
        ref: sourceRef,
        dictionary,
        patternType: 2,
        kind: "shading",
        matrix,
        resources: resources.dictionary,
        resourceOrigin: resources.origin,
        shadingIndex,
        shading: this.shadings.describe(shadingIndex),
        extGState
      };
    }

    if (this.records.length >= this.maxPatterns) {
      throw new PdfError("resource-limit", `PDF pattern count exceeds ${this.maxPatterns}.`, {
        details: { feature: "pattern", reason: "pattern-count", limit: this.maxPatterns }
      });
    }
    const index = this.records.length;
    const pattern = Object.freeze({ ...draft, index }) as Readonly<NativePdfPatternDescription>;
    const record = Object.freeze({ pattern, stream, semanticIdentity });
    this.records.push(record);
    this.recordByDescription.set(pattern, record);
    return record;
  }

  private async validatePatternMarker(
    dictionary: PdfDictionary,
    label: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (!dictionary.has("Type")) return;
    const type = await this.document.resolveValue(dictionary.get("Type"), signal);
    if (!isPdfName(type, "Pattern")) {
      throw new PdfError("invalid-object", `${label} /Type is not /Pattern.`, {
        details: { feature: "pattern", reason: "invalid-pattern-marker" }
      });
    }
  }

  private async resolvePatternResources(
    dictionary: PdfDictionary,
    inherited: PdfDictionary | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<EffectiveResourceScope> {
    if (dictionary.has("Resources")) {
      const raw = dictionary.get("Resources");
      if (raw === undefined || raw === null) {
        throw new PdfError("invalid-object", `${label} has a null /Resources entry.`, {
          details: { feature: "pattern" }
        });
      }
      const local = await this.document.resolveDictionary(raw, signal);
      return {
        dictionary: local,
        origin: "local",
        identity: this.valueIdentity(raw, local)
      };
    }
    if (inherited) {
      return {
        dictionary: inherited,
        origin: inherited === EMPTY_RESOURCES ? "empty" : "inherited",
        identity: this.objectIdentity(inherited)
      };
    }
    return { dictionary: EMPTY_RESOURCES, origin: "empty", identity: "empty" };
  }

  private async resolveExtGState(
    value: PdfValue | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<PdfDictionary> {
    const resolved = await this.document.resolveValue(value, signal);
    if (!isPdfDictionary(resolved)) {
      throw new PdfError("invalid-object", `${label} /ExtGState is not a dictionary.`, {
        details: { feature: "pattern", reason: "invalid-pattern-extgstate" }
      });
    }
    return resolved;
  }

  private createRootInvocation(record: PatternRecord): NativePdfPatternInvocation {
    return Object.freeze({
      pattern: record.pattern,
      depth: 1,
      ancestry: Object.freeze([record.semanticIdentity])
    });
  }

  private getRecord(index: number): PatternRecord {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.records.length) {
      throw new RangeError(`PDF pattern index ${index} is out of range.`);
    }
    return this.records[index];
  }

  private recordForDescription(pattern: Readonly<NativePdfPatternDescription>): PatternRecord {
    const record = this.recordByDescription.get(pattern);
    if (!record) throw new TypeError("The pattern invocation was not created by this registry.");
    return record;
  }

  private valueIdentity(raw: PdfValue, resolved: object): string {
    return isPdfRef(raw) ? `ref:${pdfRefKey(raw)}` : this.objectIdentity(resolved);
  }

  private objectIdentity(value: object): string {
    let id = this.objectIds.get(value);
    if (id === undefined) {
      id = this.nextObjectId++;
      this.objectIds.set(value, id);
    }
    return `object:${id}`;
  }
}

function emptyStack(): ResolutionStack {
  return { refs: new Set(), resourceNames: new Set() };
}

function normalizeResourceName(value: string): string {
  const normalized = value.startsWith("/") ? value.slice(1) : value;
  if (normalized.length === 0) throw new TypeError("A PDF pattern resource name cannot be empty.");
  return normalized;
}

function boundedOption(value: number | undefined, ceiling: number, label: string): number {
  const configured = value ?? ceiling;
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
  if (configured > ceiling) {
    throw new RangeError(`${label} may lower, but cannot raise, the document ceiling of ${ceiling}.`);
  }
  return configured;
}

async function requiredInteger(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  label: string,
  signal?: AbortSignal
): Promise<number> {
  const resolved = await document.resolveValue(value, signal);
  if (typeof resolved !== "number" || !Number.isSafeInteger(resolved)) {
    throw new PdfError("invalid-object", `${label} is not an integer.`, {
      details: { feature: "pattern" }
    });
  }
  return resolved;
}

async function requiredNumber(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  label: string,
  signal?: AbortSignal
): Promise<number> {
  const resolved = await document.resolveValue(value, signal);
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    throw new PdfError("invalid-object", `${label} is not a finite number.`, {
      details: { feature: "pattern" }
    });
  }
  assertFloat32(resolved, label);
  return resolved;
}

async function requiredNumberArray(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  length: number,
  label: string,
  signal?: AbortSignal
): Promise<readonly number[]> {
  const resolved = await document.resolveValue(value, signal);
  if (!Array.isArray(resolved) || resolved.length !== length) {
    throw new PdfError("invalid-object", `${label} is not a ${length}-number array.`, {
      details: { feature: "pattern" }
    });
  }
  const values: number[] = [];
  for (const item of resolved) {
    const number = await document.resolveValue(item, signal);
    if (typeof number !== "number" || !Number.isFinite(number)) {
      throw new PdfError("invalid-object", `${label} contains a non-finite number.`, {
        details: { feature: "pattern" }
      });
    }
    assertFloat32(number, label);
    values.push(number);
  }
  return values;
}

function normalizeRectangle(values: readonly number[]): NativePdfPatternRectangle {
  return Object.freeze([
    Math.min(values[0], values[2]),
    Math.min(values[1], values[3]),
    Math.max(values[0], values[2]),
    Math.max(values[1], values[3])
  ]);
}

function asMatrix(values: readonly number[]): NativePdfPatternMatrix {
  return Object.freeze([values[0], values[1], values[2], values[3], values[4], values[5]]);
}

function assertFloat32(value: number, label: string): void {
  if (!Number.isFinite(Math.fround(value))) {
    throw new PdfError("resource-limit", `${label} is outside the Float32 sidecar range.`, {
      details: { feature: "pattern", reason: "pattern-float-range" }
    });
  }
}

function resourceOriginCode(origin: NativePdfPatternResourceOrigin): number {
  switch (origin) {
    case "empty": return 0;
    case "inherited": return 1;
    case "local": return 2;
  }
}

function patternError(
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>
): PdfError {
  return new PdfError("unsupported-content", message, {
    details: { feature: "pattern", ...details }
  });
}
