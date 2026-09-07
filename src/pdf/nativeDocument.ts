import {
  PdfCosParser,
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  isPdfString,
  pdfRefKey,
  type PdfDictionary,
  type PdfRef,
  type PdfStream,
  type PdfString,
  type PdfValue
} from "./nativeCos";
import {
  decodePdfFilterChain,
  decodePdfFilterChainChunks,
  readDecodeParameters,
  readFilterNames
} from "./nativeFilters";
import { readIndirectObjectAt } from "./nativeObjects";
import {
  createPdfRandomAccessReader,
  type PdfRandomAccessReader
} from "./nativeSource";
import {
  PdfError,
  type PdfDiagnostic,
  type PdfResourceLimits,
  type PdfSource,
  mergePdfLimits,
  throwIfAborted
} from "./nativeTypes";
import { readNativeXref, repairNativeXref, type NativeXrefResult } from "./nativeXref";

export interface NativePdfOpenOptions {
  /** Strict parsing is always attempted first. @default "safe" */
  readonly repair?: "off" | "safe";
  readonly limits?: Partial<PdfResourceLimits>;
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
}

export interface NativePdfStreamDecodeOptions {
  /** Maximum yielded decoded chunk size. @default 262144 */
  readonly chunkSize?: number;
  readonly signal?: AbortSignal;
}

export interface NativePdfDocumentInfo {
  readonly version: string;
  readonly byteLength: number;
  readonly pageCount: number;
  readonly repaired: boolean;
  readonly linearized: boolean;
  readonly label?: string;
  readonly language?: string;
  /** Lower-case hexadecimal first trailer /ID entry, when present. */
  readonly fingerprint?: string;
  readonly metadata: Readonly<NativePdfDocumentMetadata>;
  readonly hasAcroForm: boolean;
}

export interface NativePdfDocumentMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: string;
  readonly creator?: string;
  readonly producer?: string;
  readonly creationDate?: string;
  readonly modificationDate?: string;
}

/** An exact page rectangle in unscaled PDF default-user-space units. */
export type NativePdfPageBox = readonly [left: number, bottom: number, right: number, top: number];

export interface NativePdfPage {
  readonly sourcePageIndex: number;
  readonly ref: PdfRef | null;
  readonly dictionary: PdfDictionary;
  readonly mediaBox: NativePdfPageBox;
  readonly cropBox: NativePdfPageBox;
  readonly bleedBox?: NativePdfPageBox;
  readonly trimBox?: NativePdfPageBox;
  readonly artBox?: NativePdfPageBox;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly userUnit: number;
  readonly resources?: PdfValue;
  readonly contents?: PdfValue;
  readonly annotations?: PdfValue;
}

interface InheritedPageValues {
  readonly MediaBox?: readonly PdfValue[];
  readonly CropBox?: readonly PdfValue[];
  readonly Resources?: readonly PdfValue[];
  readonly Rotate?: readonly PdfValue[];
}

interface PageTreeNode {
  readonly raw: PdfValue;
  readonly ref: PdfRef | null;
  readonly dictionary: PdfDictionary;
}

interface PageTreeWalkState {
  readonly pages: NativePdfPage[];
  readonly visitedRefs: Set<string>;
  readonly visitedDictionaries: WeakSet<PdfDictionary>;
  nodeCount: number;
}

interface ParsedObjectStream {
  readonly byObjectNumber: ReadonlyMap<number, PdfValue>;
  readonly objectNumbersByIndex: readonly number[];
  readonly decodedByteLength: number;
}

/**
 * Dependency-free PDF structure document. Page metadata is complete when open
 * resolves; indirect resources and stream payloads remain lazy.
 */
export class NativePdfDocument {
  readonly info: NativePdfDocumentInfo;
  readonly pages: readonly NativePdfPage[];
  readonly catalog: PdfDictionary;
  readonly limits: Readonly<PdfResourceLimits>;

  private readonly diagnostics: PdfDiagnostic[];
  private readonly xref: NativeXrefResult;
  private readonly objectCache = new Map<string, Promise<PdfValue>>();
  private readonly objectStreamCache = new Map<number, Promise<ParsedObjectStream>>();
  private readonly objectStreamCacheByteLengths = new Map<number, number>();
  private readonly repairedDuplicateDictionaryKeys = new Set<string>();
  private readonly repairedMissingStreamEndEols = new Set<string>();
  private readonly lifetime = new AbortController();
  private readonly reader: PdfRandomAccessReader;
  private readonly repairMalformedStreamFraming: boolean;
  private objectStreamCacheBytes = 0;
  private closed = false;

  private constructor(
    reader: PdfRandomAccessReader,
    xref: NativeXrefResult,
    catalog: PdfDictionary,
    pages: readonly NativePdfPage[],
    info: NativePdfDocumentInfo,
    limits: Readonly<PdfResourceLimits>,
    diagnostics: PdfDiagnostic[],
    repairMalformedStreamFraming: boolean
  ) {
    this.reader = reader;
    this.xref = xref;
    this.catalog = catalog;
    this.pages = Object.freeze([...pages]);
    this.info = Object.freeze(info);
    this.limits = limits;
    this.diagnostics = diagnostics;
    this.repairMalformedStreamFraming = repairMalformedStreamFraming;
  }

  static async open(source: PdfSource, options: NativePdfOpenOptions = {}): Promise<NativePdfDocument> {
    const limits = mergePdfLimits(options.limits);
    const diagnostics: PdfDiagnostic[] = [];
    let opened = false;
    const recordSourceDiagnostic = (diagnostic: PdfDiagnostic): void => {
      diagnostics.push(diagnostic);
      if (opened) options.onDiagnostic?.(copyPdfDiagnostic(diagnostic));
    };
    const reader = await createPdfRandomAccessReader(source, {
      limits,
      signal: options.signal,
      onDiagnostic: recordSourceDiagnostic
    });
    try {
      const headerVersion = await readPdfHeader(reader, options.signal);
      let xref = await readNativeXref(
        reader,
        limits,
        options.repair ?? "safe",
        diagnostics,
        options.signal
      );
      const finishOpen = async (): Promise<NativePdfDocument> => {
        rejectEncryption(xref);
        // Failed strict bootstraps must not leak partial or duplicate diagnostics
        // into the one repaired attempt.
        const attemptDiagnostics: PdfDiagnostic[] = [];
        const bootstrap = new NativePdfDocument(
          reader,
          xref,
          new Map(),
          [],
          {
            version: headerVersion,
            byteLength: reader.byteLength,
            pageCount: 0,
            repaired: xref.repaired,
            linearized: false,
            label: reader.label,
            metadata: Object.freeze({}),
            hasAcroForm: false
          },
          limits,
          attemptDiagnostics,
          (options.repair ?? "safe") === "safe"
        );
        const catalog = await bootstrap.findCatalog(options.signal);
        const version = effectivePdfVersion(
          headerVersion,
          await bootstrap.resolveValue(catalog.get("Version"), options.signal)
        );
        const pages = await bootstrap.readPages(catalog, options.signal);
        const linearized = await bootstrap.detectLinearized(pages, options.signal);
        const language = await readDocumentLanguage(
          bootstrap,
          catalog,
          attemptDiagnostics,
          options.signal
        );
        const metadata = await readDocumentMetadata(
          bootstrap,
          xref.trailers,
          attemptDiagnostics,
          options.signal
        );
        const fingerprint = await readDocumentFingerprint(
          bootstrap,
          xref.trailers,
          attemptDiagnostics,
          options.signal
        );
        const info: NativePdfDocumentInfo = {
          version,
          byteLength: reader.byteLength,
          pageCount: pages.length,
          repaired: xref.repaired,
          linearized,
          label: reader.label,
          language,
          fingerprint,
          metadata,
          hasAcroForm: catalog.get("AcroForm") !== undefined && catalog.get("AcroForm") !== null
        };
        diagnostics.push(...attemptDiagnostics);
        const document = new NativePdfDocument(
          reader,
          xref,
          catalog,
          pages,
          info,
          limits,
          diagnostics,
          (options.repair ?? "safe") === "safe"
        );
        // Preserve lazy objects resolved while bootstrapping the catalog/page tree.
        for (const [key, value] of bootstrap.objectCache) document.objectCache.set(key, value);
        for (const [key, value] of bootstrap.objectStreamCache) document.objectStreamCache.set(key, value);
        for (const [key, value] of bootstrap.objectStreamCacheByteLengths) {
          document.objectStreamCacheByteLengths.set(key, value);
        }
        for (const key of bootstrap.repairedDuplicateDictionaryKeys) {
          document.repairedDuplicateDictionaryKeys.add(key);
        }
        for (const key of bootstrap.repairedMissingStreamEndEols) {
          document.repairedMissingStreamEndEols.add(key);
        }
        document.objectStreamCacheBytes = bootstrap.objectStreamCacheBytes;
        return document;
      };
      let document: NativePdfDocument;
      try {
        document = await finishOpen();
      } catch (strictError) {
        if (
          (options.repair ?? "safe") !== "safe" ||
          xref.repaired ||
          !isRepairableBootstrapError(strictError)
        ) throw strictError;

        // Duplicate dictionary keys do not invalidate an otherwise strict
        // xref. Retry only the lazy bootstrap objects under the deterministic
        // keep-last policy before paying for a source-wide structural scan.
        // `repaired` is the existing switch used by object/object-stream
        // parsers to enable that policy and emit per-object diagnostics.
        let targetedDocument: NativePdfDocument | null = null;
        let repairCause: unknown = strictError;
        const strictXref = xref;
        if (isDuplicateDictionaryKeyError(strictError)) {
          const diagnosticInsertionIndex = diagnostics.length;
          xref = { ...strictXref, repaired: true };
          try {
            targetedDocument = await finishOpen();
            diagnostics.splice(
              diagnosticInsertionIndex,
              0,
              ...targetedDuplicateDictionaryRepairDiagnostics(strictError, xref)
            );
          } catch (targetedError) {
            xref = strictXref;
            if (!isRepairableBootstrapError(targetedError)) throw targetedError;
            repairCause = targetedError;
          }
        }

        if (targetedDocument) {
          document = targetedDocument;
        } else {
          xref = await repairNativeXref(
            reader,
            limits,
            diagnostics,
            repairCause,
            options.signal,
            strictXref.startXref
          );
          document = await finishOpen();
        }
      }
      for (const diagnostic of diagnostics) options.onDiagnostic?.(copyPdfDiagnostic(diagnostic));
      opened = true;
      return document;
    } catch (error) {
      await reader.close().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Resolve exactly one indirect reference. Undefined, free, and stale-generation
   * references have the PDF null-object value; results are cached and deduplicated.
   */
  async resolveObject(ref: PdfRef, signal?: AbortSignal): Promise<PdfValue> {
    this.assertOpen();
    return await this.resolveObjectInternal(ref, new Set(), this.operationSignal(signal));
  }

  /** Resolve a reference or return a direct value unchanged. */
  async resolveValue(value: PdfValue | undefined, signal?: AbortSignal): Promise<PdfValue | undefined> {
    this.assertOpen();
    if (!isPdfRef(value)) return value;
    return await this.resolveObject(value, signal);
  }

  /** Resolve a value and require a non-stream dictionary. */
  async resolveDictionary(value: PdfValue | undefined, signal?: AbortSignal): Promise<PdfDictionary> {
    const resolved = await this.resolveValue(value, signal);
    if (!isPdfDictionary(resolved)) {
      throw new PdfError("invalid-object", "Expected a PDF dictionary.");
    }
    return resolved;
  }

  /** Decode all filters and predictors on a raw stream under the document limits. */
  async decodeStream(stream: PdfStream, signal?: AbortSignal): Promise<Uint8Array> {
    this.assertOpen();
    const operationSignal = this.operationSignal(signal);
    const filterValue = await this.resolveContainerValues(stream.dictionary.get("Filter"), operationSignal);
    const filters = readFilterNames(filterValue);
    const paramsValue = await this.resolveFilterParameters(
      stream.dictionary.get("DecodeParms") ?? stream.dictionary.get("DP"),
      operationSignal
    );
    const parameters = readDecodeParameters(paramsValue, filters.length);
    return await decodePdfFilterChain(stream.bytes, filters, parameters, {
      limits: this.limits,
      signal: operationSignal
    });
  }

  /**
   * Decode a raw stream as bounded chunks. A single FlateDecode filter with
   * Predictor=1 is consumed incrementally; other chains retain the established
   * whole-buffer decoder and are exposed as bounded views of that result.
   */
  async *decodeStreamChunks(
    stream: PdfStream,
    options: NativePdfStreamDecodeOptions = {}
  ): AsyncIterable<Uint8Array> {
    this.assertOpen();
    const operationSignal = this.operationSignal(options.signal);
    const filterValue = await this.resolveContainerValues(
      stream.dictionary.get("Filter"),
      operationSignal
    );
    const filters = readFilterNames(filterValue);
    const paramsValue = await this.resolveFilterParameters(
      stream.dictionary.get("DecodeParms") ?? stream.dictionary.get("DP"),
      operationSignal
    );
    const parameters = readDecodeParameters(paramsValue, filters.length);
    for await (const chunk of decodePdfFilterChainChunks(
      stream.bytes,
      filters,
      parameters,
      {
        limits: this.limits,
        chunkSize: options.chunkSize,
        signal: operationSignal
      }
    )) {
      yield chunk;
    }
  }

  /** Resolve a page's /Contents entry into raw streams in source paint order. */
  async getPageContentStreams(pageIndex: number, signal?: AbortSignal): Promise<readonly PdfStream[]> {
    const page = this.getPage(pageIndex);
    if (page.contents === undefined || page.contents === null) return [];
    const operationSignal = this.operationSignal(signal);
    const contents = await this.resolveValue(page.contents, operationSignal);
    const values = Array.isArray(contents) ? contents : [contents];
    const streams: PdfStream[] = [];
    for (const value of values) {
      const resolved = await this.resolveValue(value, operationSignal);
      if (!isPdfStream(resolved)) {
        throw new PdfError("invalid-object", "A page /Contents entry is not a stream.", {
          pageIndex
        });
      }
      streams.push(resolved);
    }
    return streams;
  }

  /** Decode a page's content streams without concatenating or reordering them. */
  async getDecodedPageContents(pageIndex: number, signal?: AbortSignal): Promise<readonly Uint8Array[]> {
    const operationSignal = this.operationSignal(signal);
    const streams = await this.getPageContentStreams(pageIndex, operationSignal);
    const decoded: Uint8Array[] = [];
    for (const stream of streams) decoded.push(await this.decodeStream(stream, operationSignal));
    return decoded;
  }

  getPage(pageIndex: number): NativePdfPage {
    this.assertOpen();
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pages.length) {
      throw new PdfError("invalid-page-index", `PDF page index ${pageIndex} is out of range.`, {
        details: { pageIndex, pageCount: this.pages.length }
      });
    }
    return this.pages[pageIndex];
  }

  getDiagnostics(): readonly PdfDiagnostic[] {
    return Object.freeze(this.diagnostics.map(copyPdfDiagnostic));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort(new PdfError("closed", "The PDF document is closed."));
    this.objectCache.clear();
    this.objectStreamCache.clear();
    this.objectStreamCacheByteLengths.clear();
    this.objectStreamCacheBytes = 0;
    await this.reader.close();
  }

  private async resolveObjectInternal(
    ref: PdfRef,
    stack: Set<string>,
    signal: AbortSignal
  ): Promise<PdfValue> {
    throwIfAborted(signal);
    const key = pdfRefKey(ref);
    if (stack.has(key)) {
      throw new PdfError("invalid-object", "The PDF indirect-object graph contains a cycle.", {
        objectNumber: ref.objectNumber
      });
    }
    if (stack.size >= this.limits.maxRecursionDepth) {
      throw new PdfError("resource-limit", "Indirect-object resolution exceeds the recursion limit.", {
        objectNumber: ref.objectNumber,
        details: {
          reason: "indirect-object-depth",
          depth: stack.size + 1,
          limit: this.limits.maxRecursionDepth
        }
      });
    }
    const existing = this.objectCache.get(key);
    if (existing) {
      this.objectCache.delete(key);
      this.objectCache.set(key, existing);
      return await existing;
    }
    const nextStack = new Set(stack);
    nextStack.add(key);
    const promise = this.loadObject(ref, nextStack, signal).catch((error) => {
      this.objectCache.delete(key);
      throw error;
    });
    this.objectCache.set(key, promise);
    while (this.objectCache.size > this.limits.maxCachedObjects) {
      const oldest = this.objectCache.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === key) break;
      this.objectCache.delete(oldest);
    }
    return await promise;
  }

  private async loadObject(ref: PdfRef, stack: Set<string>, signal: AbortSignal): Promise<PdfValue> {
    const entry = this.xref.entries.get(ref.objectNumber);
    // ISO 32000 defines a reference to an undefined or deleted object as a
    // reference to the null object. A generation that is no longer current is
    // likewise undefined; it must never resolve to the current generation.
    if (!entry || entry.kind === "free" || entry.generation !== ref.generation) return null;
    if (entry.kind === "uncompressed") {
      const indirect = await readIndirectObjectAt(this.reader, entry.offset, this.limits, signal, {
        resolveLength: async (value) => {
          const resolved = isPdfRef(value)
            ? await this.resolveObjectInternal(value, stack, signal)
            : value;
          return typeof resolved === "number" ? resolved : undefined;
        },
        ...(this.xref.repaired
          ? {
              duplicateDictionaryKeys: "keep-last" as const,
              onDuplicateDictionaryKey: (key: string, offset: number) => {
                this.recordRepairedDuplicateDictionaryKey(ref.objectNumber, key, offset);
              }
            }
          : {}),
        repairMissingStreamEndEol: this.repairMalformedStreamFraming,
        onMissingStreamEndEol: (offset: number) => {
          this.recordRepairedMissingStreamEndEol(ref.objectNumber, offset);
        }
      });
      if (
        indirect.ref.objectNumber !== ref.objectNumber ||
        indirect.ref.generation !== ref.generation
      ) {
        throw new PdfError("invalid-xref", "An xref entry points to a different indirect object.", {
          offset: entry.offset,
          objectNumber: ref.objectNumber
        });
      }
      return indirect.value;
    }
    const parsed = await this.resolveObjectStream(entry.objectStreamNumber, stack, signal);
    if (parsed.objectNumbersByIndex[entry.objectStreamIndex] !== ref.objectNumber) {
      throw new PdfError("invalid-xref", "A compressed xref entry has the wrong object-stream index.", {
        objectNumber: ref.objectNumber
      });
    }
    const value = parsed.byObjectNumber.get(ref.objectNumber);
    if (value === undefined) {
      throw new PdfError("invalid-object", "An object stream does not contain the requested object.", {
        objectNumber: ref.objectNumber
      });
    }
    return value;
  }

  private resolveObjectStream(
    objectStreamNumber: number,
    stack: Set<string>,
    signal: AbortSignal
  ): Promise<ParsedObjectStream> {
    const existing = this.objectStreamCache.get(objectStreamNumber);
    if (existing) {
      this.objectStreamCache.delete(objectStreamNumber);
      this.objectStreamCache.set(objectStreamNumber, existing);
      return existing;
    }
    const ref: PdfRef = { kind: "ref", objectNumber: objectStreamNumber, generation: 0 };
    let promise: Promise<ParsedObjectStream>;
    promise = this.resolveObjectInternal(ref, stack, signal).then(async (value) => {
      if (!isPdfStream(value) || !isPdfName(value.dictionary.get("Type"), "ObjStm")) {
        throw new PdfError("invalid-object", "A compressed object points to an invalid /ObjStm.", {
          objectNumber: objectStreamNumber
        });
      }
      const count = requiredInteger(value.dictionary.get("N"), "ObjStm N", 0);
      const first = requiredInteger(value.dictionary.get("First"), "ObjStm First", 0);
      if (count > this.limits.maxRepairCandidates) {
        throw new PdfError("resource-limit", "An object stream contains too many objects.", {
          objectNumber: objectStreamNumber
        });
      }
      const decoded = await this.decodeStream(value, signal);
      if (first > decoded.length) {
        throw new PdfError("invalid-object", "An object stream /First offset is outside the stream.");
      }
      const header = new PdfCosParser(decoded, { maxDepth: this.limits.maxRecursionDepth });
      const objectNumbers: number[] = [];
      const relativeOffsets: number[] = [];
      for (let index = 0; index < count; index += 1) {
        objectNumbers.push(header.readInteger());
        relativeOffsets.push(header.readInteger());
      }
      if (header.position > first) {
        throw new PdfError("invalid-object", "An object stream header overlaps its object data.");
      }
      if (count > 0 && relativeOffsets[0] !== 0) {
        throw new PdfError("invalid-object", "An object stream's first relative offset must be zero.");
      }
      for (let index = 0; index < count; index += 1) {
        const relativeOffset = relativeOffsets[index];
        if (
          relativeOffset < 0 || relativeOffset > decoded.length - first ||
          (index > 0 && relativeOffset <= relativeOffsets[index - 1])
        ) {
          throw new PdfError("invalid-object", "An object stream contains invalid object offsets.");
        }
      }
      const byObjectNumber = new Map<number, PdfValue>();
      for (let index = 0; index < count; index += 1) {
        const position = first + relativeOffsets[index];
        const nextPosition = index + 1 < count ? first + relativeOffsets[index + 1] : decoded.length;
        if (position < first || position >= nextPosition || nextPosition > decoded.length) {
          throw new PdfError("invalid-object", "An object stream contains invalid object offsets.");
        }
        const parser = new PdfCosParser(decoded, {
          position,
          maxDepth: this.limits.maxRecursionDepth,
          ...(this.xref.repaired
            ? {
                duplicateDictionaryKeys: "keep-last" as const,
                onDuplicateDictionaryKey: (key: string) => {
                  this.recordRepairedDuplicateDictionaryKey(objectNumbers[index], key);
                }
              }
            : {})
        });
        const objectNumber = objectNumbers[index];
        if (!Number.isSafeInteger(objectNumber) || objectNumber <= 0 || byObjectNumber.has(objectNumber)) {
          throw new PdfError("invalid-object", "An object stream contains invalid object numbers.");
        }
        const parsed = parser.parseValue();
        if (isPdfRef(parsed)) {
          throw new PdfError("invalid-object", "A compressed object cannot be only an indirect reference.");
        }
        parser.skipWhitespaceAndComments();
        if (parser.position !== nextPosition) {
          throw new PdfError("invalid-object", "An object stream value does not end at its declared boundary.");
        }
        byObjectNumber.set(objectNumber, parsed);
      }
      this.reserveObjectStreamCacheBytes(objectStreamNumber, promise, decoded.length);
      return {
        byObjectNumber,
        objectNumbersByIndex: objectNumbers,
        decodedByteLength: decoded.length
      };
    }).catch((error) => {
      this.deleteObjectStreamCacheEntry(objectStreamNumber, promise);
      throw error;
    });
    this.objectStreamCache.set(objectStreamNumber, promise);
    while (this.objectStreamCache.size > this.limits.maxCachedObjects) {
      const oldest = this.objectStreamCache.keys().next().value as number | undefined;
      if (oldest === undefined || oldest === objectStreamNumber) break;
      this.deleteObjectStreamCacheEntry(oldest);
    }
    return promise;
  }

  private recordRepairedDuplicateDictionaryKey(
    objectNumber: number,
    key: string,
    offset?: number
  ): void {
    const identity = `${objectNumber}:${offset ?? "compressed"}:${key}`;
    if (this.repairedDuplicateDictionaryKeys.has(identity)) return;
    this.repairedDuplicateDictionaryKeys.add(identity);
    this.diagnostics.push({
      code: "object.duplicate-key-repaired",
      severity: "warning",
      message: `Structural repair retained the last definition of duplicate /${key}.`,
      ...(offset === undefined ? {} : { offset }),
      objectNumber,
      details: { key, policy: "keep-last" }
    });
  }

  private recordRepairedMissingStreamEndEol(
    objectNumber: number,
    offset: number
  ): void {
    const identity = `${objectNumber}:${offset}`;
    if (this.repairedMissingStreamEndEols.has(identity)) return;
    this.repairedMissingStreamEndEols.add(identity);
    this.diagnostics.push({
      code: "object.stream-end-eol-repaired",
      severity: "warning",
      message: "Structural repair accepted an exact stream boundary without its required end-of-line marker.",
      offset,
      objectNumber,
      details: { reason: "missing-stream-end-eol" }
    });
  }

  private reserveObjectStreamCacheBytes(
    objectStreamNumber: number,
    promise: Promise<ParsedObjectStream>,
    decodedBytes: number
  ): void {
    // The object-count LRU may evict a still-running parse. Such a result is
    // returned to its caller but is not retained and therefore consumes no
    // object-stream cache budget.
    if (this.objectStreamCache.get(objectStreamNumber) !== promise) return;
    const limit = this.limits.maxObjectStreamCacheBytes;
    if (decodedBytes > limit - this.objectStreamCacheBytes) {
      throw new PdfError(
        "resource-limit",
        "Decoded object-stream cache exceeds its configured aggregate byte limit.",
        {
          objectNumber: objectStreamNumber,
          details: {
            reason: "object-stream-cache-bytes",
            cachedBytes: this.objectStreamCacheBytes,
            decodedBytes,
            limit
          }
        }
      );
    }
    this.objectStreamCacheBytes += decodedBytes;
    this.objectStreamCacheByteLengths.set(objectStreamNumber, decodedBytes);
  }

  private deleteObjectStreamCacheEntry(
    objectStreamNumber: number,
    expected?: Promise<ParsedObjectStream>
  ): void {
    if (expected !== undefined && this.objectStreamCache.get(objectStreamNumber) !== expected) return;
    if (!this.objectStreamCache.delete(objectStreamNumber)) return;
    const decodedBytes = this.objectStreamCacheByteLengths.get(objectStreamNumber);
    if (decodedBytes === undefined) return;
    this.objectStreamCacheByteLengths.delete(objectStreamNumber);
    this.objectStreamCacheBytes -= decodedBytes;
  }

  private async findCatalog(signal?: AbortSignal): Promise<PdfDictionary> {
    for (const trailer of this.xref.trailers) {
      const root = trailer.get("Root");
      // A null object is equivalent to an absent entry. This matters for
      // incremental trailers which inherit /Root from an older revision.
      if (root === undefined || root === null) continue;
      const resolved = await this.resolveValue(root, signal);
      if (!isPdfDictionary(resolved)) {
        throw new PdfError("invalid-object", "The trailer /Root is not a dictionary.");
      }
      const type = await this.resolveValue(resolved.get("Type"), signal);
      if (!isPdfName(type, "Catalog")) {
        throw new PdfError("invalid-object", "The trailer /Root is not a /Catalog dictionary.");
      }
      return resolved;
    }
    if (!this.xref.repaired) {
      throw new PdfError("invalid-object", "The PDF trailer does not contain /Root.");
    }
    // Bounded repair fallback: resolve structural candidates only until a
    // genuine Catalog dictionary is found.
    for (const [objectNumber, entry] of this.xref.entries) {
      if (entry.kind === "free") continue;
      try {
        const value = await this.resolveObject({
          kind: "ref",
          objectNumber,
          generation: entry.generation
        }, signal);
        if (
          isPdfDictionary(value) &&
          isPdfName(await this.resolveValue(value.get("Type"), signal), "Catalog")
        ) {
          this.diagnostics.push({
            code: "catalog.repaired",
            severity: "warning",
            message: "Structural repair recovered a catalog without a usable trailer /Root.",
            objectNumber
          });
          return value;
        }
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof PdfError &&
            (error.code === "aborted" ||
              error.code === "resource-limit" ||
              error.code === "source-changed" ||
              error.code === "source-read" ||
              error.code === "closed"))
        ) throw error;
        // False-positive structural candidates are expected during repair.
      }
    }
    throw new PdfError("invalid-object", "PDF repair could not recover a catalog.");
  }

  private async readPages(catalog: PdfDictionary, signal?: AbortSignal): Promise<NativePdfPage[]> {
    const rootPages = catalog.get("Pages");
    if (rootPages === undefined || rootPages === null) {
      throw new PdfError("invalid-page-tree", "The PDF catalog has no /Pages tree.");
    }
    const state: PageTreeWalkState = {
      pages: [],
      visitedRefs: new Set(),
      visitedDictionaries: new WeakSet(),
      nodeCount: 0
    };
    await this.walkPageTree(
      rootPages,
      {},
      0,
      null,
      state,
      this.operationSignal(signal)
    );
    return state.pages;
  }

  private async walkPageTree(
    rawNode: PdfValue,
    inherited: InheritedPageValues,
    depth: number,
    expectedParent: PageTreeNode | null,
    state: PageTreeWalkState,
    signal: AbortSignal
  ): Promise<number> {
    throwIfAborted(signal);
    if (depth > this.limits.maxRecursionDepth) {
      throw new PdfError("resource-limit", "The PDF page tree exceeds the recursion limit.", {
        details: { reason: "page-tree-depth", limit: this.limits.maxRecursionDepth }
      });
    }
    let ref: PdfRef | null = null;
    if (isPdfRef(rawNode)) {
      ref = rawNode;
      const key = pdfRefKey(rawNode);
      if (state.visitedRefs.has(key)) {
        throw new PdfError("invalid-page-tree", "The PDF page tree contains a cycle or duplicate node.");
      }
      state.visitedRefs.add(key);
    } else if (!isPdfDictionary(rawNode)) {
      throw new PdfError("invalid-page-tree", "A page-tree /Kids entry is not a dictionary or reference.");
    }
    const resolvedNode = await this.resolveValue(rawNode, signal);
    if (!isPdfDictionary(resolvedNode)) {
      throw new PdfError("invalid-page-tree", "A page-tree node is not a dictionary.");
    }
    if (state.visitedDictionaries.has(resolvedNode)) {
      throw new PdfError("invalid-page-tree", "The PDF page tree reuses a direct dictionary.");
    }
    state.visitedDictionaries.add(resolvedNode);
    state.nodeCount += 1;
    if (state.nodeCount > this.limits.maxRepairCandidates) {
      throw new PdfError("resource-limit", "The PDF page tree contains too many nodes.", {
        details: {
          reason: "page-tree-node-count",
          limit: this.limits.maxRepairCandidates
        }
      });
    }
    const node: PageTreeNode = { raw: rawNode, ref, dictionary: resolvedNode };
    await this.validatePageTreeParent(node, expectedParent, signal);
    const type = await this.resolveValue(resolvedNode.get("Type"), signal);
    if (expectedParent === null && !isPdfName(type, "Pages")) {
      throw new PdfError("invalid-page-tree", "The catalog /Pages entry is not a /Pages node.", {
        objectNumber: ref?.objectNumber,
        details: { reason: "page-tree-root-type" }
      });
    }
    if (isPdfName(type, "Pages")) {
      const kidsValue = await this.resolveValue(resolvedNode.get("Kids"), signal);
      if (!Array.isArray(kidsValue)) {
        throw new PdfError("invalid-page-tree", "A /Pages node has no valid /Kids array.");
      }
      if (kidsValue.length > this.limits.maxRepairCandidates) {
        throw new PdfError("resource-limit", "A page-tree /Kids array is too large.", {
          objectNumber: ref?.objectNumber,
          details: {
            reason: "page-tree-kids-count",
            kidCount: kidsValue.length,
            limit: this.limits.maxRepairCandidates
          }
        });
      }
      const nextInherited: {
        -readonly [Key in keyof InheritedPageValues]: InheritedPageValues[Key]
      } = { ...inherited };
      for (const key of ["MediaBox", "CropBox", "Resources", "Rotate"] as const) {
        const value = resolvedNode.get(key);
        if (value !== undefined && value !== null) {
          nextInherited[key] = Object.freeze([...(inherited[key] ?? []), value]);
        }
      }
      const pageStart = state.pages.length;
      for (let index = 0; index < kidsValue.length; index += 1) {
        if ((index & 0x3ff) === 0) throwIfAborted(signal);
        await this.walkPageTree(
          kidsValue[index],
          nextInherited,
          depth + 1,
          node,
          state,
          signal
        );
      }
      const actualCount = state.pages.length - pageStart;
      const count = await this.resolveValue(resolvedNode.get("Count"), signal);
      if (!Number.isSafeInteger(count) || (count as number) < 0) {
        throw new PdfError("invalid-page-tree", "A /Pages node has no valid non-negative integer /Count.", {
          objectNumber: ref?.objectNumber,
          details: { reason: "page-tree-count" }
        });
      }
      if (count !== actualCount) {
        this.diagnostics.push({
          code: "page.count-mismatch",
          severity: "warning",
          message: "A page-tree /Count does not match its traversed descendant page count.",
          ...(ref ? { objectNumber: ref.objectNumber } : {}),
          details: { declaredCount: count as number, actualCount, depth }
        });
      }
      return actualCount;
    }
    if (!isPdfName(type, "Page")) {
      throw new PdfError("invalid-page-tree", "A page-tree node has no valid /Type /Pages or /Type /Page.", {
        objectNumber: ref?.objectNumber,
        details: { reason: "page-tree-node-type" }
      });
    }
    const mediaValue = await this.resolveInheritedPageValue(resolvedNode, inherited, "MediaBox", signal);
    const mediaBox = await this.readBox(mediaValue, "MediaBox", signal);
    const cropValue = await this.resolveInheritedPageValue(resolvedNode, inherited, "CropBox", signal);
    const cropBox = cropValue === undefined
      ? mediaBox
      : await this.readBox(cropValue, "CropBox", signal);
    const pageIndex = state.pages.length;
    const effectiveCropBox = intersectPageBoxes(mediaBox, cropBox);
    if (!samePageBox(effectiveCropBox ?? mediaBox, cropBox)) {
      this.diagnostics.push({
        code: "page.box-clamped",
        severity: "warning",
        message: effectiveCropBox
          ? "The page /CropBox extends outside /MediaBox; the effective view is their intersection."
          : "The page /CropBox does not intersect /MediaBox; the effective view falls back to /MediaBox.",
        pageIndex,
        details: { noIntersection: effectiveCropBox === null }
      });
    }
    const rawRotation = await this.resolveInheritedPageValue(resolvedNode, inherited, "Rotate", signal);
    const rotationValue = rawRotation === undefined ? 0 : rawRotation;
    if (typeof rotationValue !== "number" || !Number.isFinite(rotationValue)) {
      throw new PdfError("invalid-page-tree", "A page /Rotate value is not a number.", {
        pageIndex,
        details: { reason: "page-rotation" }
      });
    }
    if (!Number.isInteger(rotationValue) || rotationValue % 90 !== 0) {
      throw new PdfError("invalid-page-tree", "A page /Rotate value is not a multiple of 90.");
    }
    const rotation = ((rotationValue % 360) + 360) % 360 as 0 | 90 | 180 | 270;
    // /UserUnit is page-local in both PDF 1.7 and PDF 2.0; unlike /Rotate,
    // it is not one of the page-tree inheritable attributes.
    const rawUserUnit = await this.resolveValue(resolvedNode.get("UserUnit"), signal);
    const userUnit = rawUserUnit === undefined || rawUserUnit === null ? 1 : rawUserUnit;
    if (typeof userUnit !== "number" || !(userUnit > 0) || userUnit > 75_000 || !Number.isFinite(userUnit)) {
      throw new PdfError("invalid-page-tree", "A page /UserUnit value is invalid.");
    }
    const effectiveView = effectiveCropBox ?? mediaBox;
    if (
      !Number.isFinite((effectiveView[2] - effectiveView[0]) * userUnit) ||
      !Number.isFinite((effectiveView[3] - effectiveView[1]) * userUnit)
    ) {
      throw new PdfError("invalid-page-tree", "A page box and /UserUnit produce non-finite dimensions.", {
        pageIndex,
        details: { reason: "page-scaled-dimensions" }
      });
    }
    if (state.pages.length >= this.limits.maxRepairCandidates) {
      throw new PdfError("resource-limit", "The PDF contains too many pages.", {
        details: { reason: "page-count", limit: this.limits.maxRepairCandidates }
      });
    }
    state.pages.push(Object.freeze({
      sourcePageIndex: pageIndex,
      ref,
      dictionary: resolvedNode,
      mediaBox,
      cropBox,
      bleedBox: await this.readOptionalBox(resolvedNode.get("BleedBox"), "BleedBox", signal),
      trimBox: await this.readOptionalBox(resolvedNode.get("TrimBox"), "TrimBox", signal),
      artBox: await this.readOptionalBox(resolvedNode.get("ArtBox"), "ArtBox", signal),
      rotation,
      userUnit,
      resources: this.readLazyInheritedPageValue(resolvedNode, inherited, "Resources"),
      contents: resolvedNode.get("Contents"),
      annotations: resolvedNode.get("Annots")
    }));
    return 1;
  }

  private async validatePageTreeParent(
    node: PageTreeNode,
    expectedParent: PageTreeNode | null,
    signal: AbortSignal
  ): Promise<void> {
    const rawParent = node.dictionary.get("Parent");
    if (expectedParent === null) {
      if (rawParent === undefined || rawParent === null) return;
      const resolvedParent = await this.resolveValue(rawParent, signal);
      if (resolvedParent === null) return;
      throw new PdfError("invalid-page-tree", "The root /Pages node must not have a /Parent.", {
        objectNumber: node.ref?.objectNumber,
        details: { reason: "page-tree-root-parent" }
      });
    }
    if (rawParent === undefined || rawParent === null) {
      throw new PdfError("invalid-page-tree", "A non-root page-tree node has no /Parent.", {
        objectNumber: node.ref?.objectNumber,
        details: { reason: "page-tree-parent-missing" }
      });
    }
    if (isPdfRef(expectedParent.raw) && isPdfRef(rawParent)) {
      if (pdfRefKey(expectedParent.raw) === pdfRefKey(rawParent)) return;
      throw new PdfError("invalid-page-tree", "A page-tree /Parent does not identify its containing /Pages node.", {
        objectNumber: node.ref?.objectNumber,
        details: { reason: "page-tree-parent-mismatch" }
      });
    }
    if (rawParent === expectedParent.dictionary) return;
    const resolvedParent = await this.resolveValue(rawParent, signal);
    if (resolvedParent !== expectedParent.dictionary) {
      throw new PdfError("invalid-page-tree", "A page-tree /Parent does not identify its containing /Pages node.", {
        objectNumber: node.ref?.objectNumber,
        details: { reason: "page-tree-parent-mismatch" }
      });
    }
  }

  private async resolveInheritedPageValue(
    dictionary: PdfDictionary,
    inherited: InheritedPageValues,
    key: Exclude<keyof InheritedPageValues, "Resources">,
    signal: AbortSignal
  ): Promise<PdfValue | undefined> {
    const candidates: PdfValue[] = [];
    const local = dictionary.get(key);
    if (local !== undefined && local !== null) candidates.push(local);
    const inheritedValues = inherited[key] ?? [];
    for (let index = inheritedValues.length - 1; index >= 0; index -= 1) {
      candidates.push(inheritedValues[index]);
    }
    for (const candidate of candidates) {
      const resolved = await this.resolveValue(candidate, signal);
      if (resolved !== null && resolved !== undefined) return resolved;
    }
    return undefined;
  }

  private readLazyInheritedPageValue(
    dictionary: PdfDictionary,
    inherited: InheritedPageValues,
    key: "Resources"
  ): PdfValue | undefined {
    const local = dictionary.get(key);
    if (local !== undefined && local !== null) return local;
    return inherited[key]?.at(-1);
  }

  private async readOptionalBox(
    value: PdfValue | undefined,
    name: string,
    signal?: AbortSignal
  ): Promise<NativePdfPageBox | undefined> {
    if (value === undefined || value === null) return undefined;
    const resolved = await this.resolveValue(value, signal);
    return resolved === null || resolved === undefined
      ? undefined
      : await this.readBox(resolved, name, signal);
  }

  private async readBox(
    value: PdfValue | undefined,
    name: string,
    signal?: AbortSignal
  ): Promise<NativePdfPageBox> {
    const resolved = await this.resolveValue(value, signal);
    if (!Array.isArray(resolved) || resolved.length !== 4) {
      throw new PdfError("invalid-page-tree", `A page /${name} is not a four-number array.`);
    }
    const numbers: number[] = [];
    for (const entry of resolved) {
      const number = await this.resolveNumber(entry, signal);
      if (number === undefined || !Number.isFinite(number)) {
        throw new PdfError("invalid-page-tree", `A page /${name} contains a non-number.`);
      }
      numbers.push(number);
    }
    if (numbers[0] === numbers[2] || numbers[1] === numbers[3]) {
      throw new PdfError("invalid-page-tree", `A page /${name} has zero area.`);
    }
    const left = Math.min(numbers[0], numbers[2]);
    const bottom = Math.min(numbers[1], numbers[3]);
    const right = Math.max(numbers[0], numbers[2]);
    const top = Math.max(numbers[1], numbers[3]);
    if (!Number.isFinite(right - left) || !Number.isFinite(top - bottom)) {
      throw new PdfError("invalid-page-tree", `A page /${name} has non-finite dimensions.`);
    }
    return Object.freeze([left, bottom, right, top]) as NativePdfPageBox;
  }

  private async resolveNumber(value: PdfValue | undefined, signal?: AbortSignal): Promise<number | undefined> {
    const resolved = await this.resolveValue(value, signal);
    return typeof resolved === "number" ? resolved : undefined;
  }

  private async resolveContainerValues(
    value: PdfValue | undefined,
    signal: AbortSignal
  ): Promise<PdfValue | undefined> {
    const resolved = await this.resolveValue(value, signal);
    if (!Array.isArray(resolved)) return resolved;
    return await Promise.all(resolved.map((entry) => this.resolveValue(entry, signal))) as PdfValue[];
  }

  private async resolveFilterParameters(
    value: PdfValue | undefined,
    signal: AbortSignal
  ): Promise<PdfValue | undefined> {
    const resolved = await this.resolveValue(value, signal);
    if (Array.isArray(resolved)) {
      const entries: PdfValue[] = [];
      for (const entry of resolved) {
        const item = await this.resolveValue(entry, signal);
        entries.push(isPdfDictionary(item)
          ? await this.resolveFilterParameterDictionary(item, signal)
          : item ?? null);
      }
      return entries;
    }
    return isPdfDictionary(resolved)
      ? await this.resolveFilterParameterDictionary(resolved, signal)
      : resolved;
  }

  private async resolveFilterParameterDictionary(
    dictionary: PdfDictionary,
    signal: AbortSignal
  ): Promise<PdfDictionary> {
    const result = new Map(dictionary);
    for (const key of ["Predictor", "Colors", "BitsPerComponent", "Columns", "EarlyChange"] as const) {
      if (result.has(key)) result.set(key, (await this.resolveValue(result.get(key), signal)) ?? null);
    }
    return result;
  }

  private async detectLinearized(
    pages: readonly NativePdfPage[],
    signal?: AbortSignal
  ): Promise<boolean> {
    try {
      const length = Math.min(this.reader.byteLength, 64 * 1024);
      const bytes = await this.reader.read(0, length, signal);
      const text = binaryString(bytes);
      const header = /%PDF-\d\.\d/.exec(text);
      if (!header) return false;
      const object = /(?:^|[\r\n])[\x00\x09\x0c\x20]*(\d+)[\x00\x09\x0a\x0c\x0d\x20]+(\d+)[\x00\x09\x0a\x0c\x0d\x20]+obj\b/g;
      object.lastIndex = header.index + header[0].length;
      const match = object.exec(text);
      if (!match) return false;
      const offset = match.index + match[0].indexOf(match[1]);
      const indirect = await readIndirectObjectAt(this.reader, offset, this.limits, signal);
      const candidate = isPdfDictionary(indirect.value)
        ? indirect.value
        : isPdfStream(indirect.value)
          ? indirect.value.dictionary
          : null;
      if (!candidate?.has("Linearized")) return false;
      const reason = isPdfStream(indirect.value)
        ? "linearization-object-is-stream"
        : validateLinearizationDictionary(
            candidate,
            indirect.ref,
            offset,
            this.reader.byteLength,
            pages
          );
      if (reason !== null) {
        this.diagnostics.push({
          code: "linearization.invalid",
          severity: "warning",
          message: "The first indirect object has an invalid or stale linearization dictionary; ordinary xref loading was retained.",
          objectNumber: indirect.ref.objectNumber,
          details: { reason }
        });
        return false;
      }
      return true;
    } catch (error) {
      if (signal?.aborted || (error instanceof PdfError && error.code === "aborted")) throw error;
      return false;
    }
  }

  private operationSignal(signal?: AbortSignal): AbortSignal {
    this.assertOpen();
    if (!signal) return this.lifetime.signal;
    if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, this.lifetime.signal]);
    if (signal.aborted) return signal;
    return this.lifetime.signal;
  }

  private assertOpen(): void {
    if (this.closed) throw new PdfError("closed", "The PDF document is closed.");
  }
}

function intersectPageBoxes(
  first: NativePdfPageBox,
  second: NativePdfPageBox
): NativePdfPageBox | null {
  const left = Math.max(first[0], second[0]);
  const bottom = Math.max(first[1], second[1]);
  const right = Math.min(first[2], second[2]);
  const top = Math.min(first[3], second[3]);
  return right > left && top > bottom
    ? Object.freeze([left, bottom, right, top]) as NativePdfPageBox
    : null;
}

function samePageBox(first: NativePdfPageBox, second: NativePdfPageBox): boolean {
  return first[0] === second[0] && first[1] === second[1] &&
    first[2] === second[2] && first[3] === second[3];
}

export async function openNativePdfDocument(
  source: PdfSource,
  options?: NativePdfOpenOptions
): Promise<NativePdfDocument> {
  return await NativePdfDocument.open(source, options);
}

async function readPdfHeader(reader: PdfRandomAccessReader, signal?: AbortSignal): Promise<string> {
  const bytes = await reader.read(0, Math.min(1024, reader.byteLength), signal);
  const match = /%PDF-(\d\.\d)/.exec(binaryString(bytes));
  if (!match) throw new PdfError("invalid-header", "The source has no PDF header in its first 1024 bytes.");
  const version = match[1];
  if (!isSupportedPdfVersion(version)) {
    throw new PdfError("invalid-header", `Unsupported PDF header version ${version}.`);
  }
  return version;
}

function rejectEncryption(xref: NativeXrefResult): void {
  if (xref.encrypted) {
    throw new PdfError("encrypted", "Encrypted PDFs are not supported, including empty-password encryption.");
  }
}

function isRepairableBootstrapError(error: unknown): boolean {
  return error instanceof PdfError && (
    error.code === "invalid-xref" ||
    error.code === "invalid-object" ||
    error.code === "invalid-page-tree" ||
    error.code === "unexpected-eof"
  );
}

function isDuplicateDictionaryKeyError(error: unknown): error is PdfError {
  return error instanceof PdfError &&
    error.code === "invalid-object" &&
    error.details?.reason === "duplicate-dictionary-key";
}

function targetedDuplicateDictionaryRepairDiagnostics(
  strictError: PdfError,
  xref: NativeXrefResult
): readonly PdfDiagnostic[] {
  const key = strictError.details?.key;
  return [
    {
      code: "xref.repaired",
      severity: "warning",
      message:
        "The strict PDF structure contained duplicate dictionary keys; HEPR retained their final values without rebuilding object offsets.",
      details: {
        strictError: strictError.message,
        repairKind: "duplicate-dictionary-key",
        ...(typeof key === "string" ? { key } : {})
      }
    },
    {
      code: "xref.repair-complete",
      severity: "info",
      message: `Targeted duplicate-key repair retained ${xref.entries.size} indexed objects.`,
      details: {
        objectCount: xref.entries.size,
        repairKind: "duplicate-dictionary-key"
      }
    }
  ];
}

function effectivePdfVersion(headerVersion: string, catalogVersion: PdfValue | undefined): string {
  if (catalogVersion === undefined || catalogVersion === null) return headerVersion;
  if (!isPdfName(catalogVersion) || !isSupportedPdfVersion(catalogVersion.value)) {
    const value = isPdfName(catalogVersion) ? catalogVersion.value : "(non-name)";
    throw new PdfError("invalid-header", `Unsupported catalog PDF version ${value}.`);
  }
  return comparePdfVersions(catalogVersion.value, headerVersion) > 0
    ? catalogVersion.value
    : headerVersion;
}

function isSupportedPdfVersion(version: string): boolean {
  return /^1\.[0-7]$/.test(version) || version === "2.0";
}

function comparePdfVersions(left: string, right: string): number {
  const [leftMajor, leftMinor] = left.split(".").map(Number);
  const [rightMajor, rightMinor] = right.split(".").map(Number);
  return leftMajor === rightMajor ? leftMinor - rightMinor : leftMajor - rightMajor;
}

function validateLinearizationDictionary(
  dictionary: PdfDictionary,
  ref: PdfRef,
  objectOffset: number,
  byteLength: number,
  pages: readonly NativePdfPage[]
): string | null {
  const linearized = dictionary.get("Linearized");
  if (typeof linearized !== "number" || !Number.isFinite(linearized) || linearized <= 0) {
    return "linearized-version";
  }
  if (ref.generation !== 0) return "linearization-object-generation";
  const declaredLength = dictionary.get("L");
  if (!Number.isSafeInteger(declaredLength) || declaredLength !== byteLength) {
    return "linearization-file-length";
  }
  const hints = dictionary.get("H");
  if (!Array.isArray(hints) || (hints.length !== 2 && hints.length !== 4)) {
    return "linearization-hints";
  }
  for (let index = 0; index < hints.length; index += 2) {
    const offset = hints[index];
    const length = hints[index + 1];
    if (
      !Number.isSafeInteger(offset) || (offset as number) < 0 ||
      !Number.isSafeInteger(length) || (length as number) < 0 ||
      (offset as number) > byteLength - (length as number)
    ) return "linearization-hints";
  }
  const firstPageObject = dictionary.get("O");
  const firstPageEnd = dictionary.get("E");
  const declaredPageCount = dictionary.get("N");
  const mainXrefOffset = dictionary.get("T");
  const firstPageIndex = dictionary.get("P") ?? 0;
  if (!Number.isSafeInteger(firstPageObject) || (firstPageObject as number) <= 0) {
    return "linearization-first-page-object";
  }
  if (
    !Number.isSafeInteger(firstPageEnd) ||
    (firstPageEnd as number) <= objectOffset ||
    (firstPageEnd as number) > byteLength
  ) return "linearization-first-page-end";
  if (
    !Number.isSafeInteger(mainXrefOffset) ||
    (mainXrefOffset as number) < 0 ||
    (mainXrefOffset as number) >= byteLength
  ) return "linearization-main-xref";
  if (
    !Number.isSafeInteger(declaredPageCount) ||
    (declaredPageCount as number) <= 0 ||
    declaredPageCount !== pages.length
  ) return "linearization-page-count";
  if (
    !Number.isSafeInteger(firstPageIndex) ||
    (firstPageIndex as number) < 0 ||
    (firstPageIndex as number) >= pages.length
  ) return "linearization-first-page-index";
  const pageRef = pages[firstPageIndex as number]?.ref;
  if (pageRef === null || pageRef === undefined || pageRef.objectNumber !== firstPageObject) {
    return "linearization-first-page-object";
  }
  return null;
}

function requiredInteger(
  value: PdfValue | undefined,
  label: string,
  minimum: number
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new PdfError("invalid-object", `${label} is not a valid integer.`);
  }
  return value as number;
}

const INFO_METADATA_KEYS = Object.freeze([
  ["Title", "title"],
  ["Author", "author"],
  ["Subject", "subject"],
  ["Keywords", "keywords"],
  ["Creator", "creator"],
  ["Producer", "producer"],
  ["CreationDate", "creationDate"],
  ["ModDate", "modificationDate"]
] as const);

async function readDocumentLanguage(
  document: NativePdfDocument,
  catalog: PdfDictionary,
  diagnostics: PdfDiagnostic[],
  signal?: AbortSignal
): Promise<string | undefined> {
  const value = catalog.get("Lang");
  if (value === undefined || value === null) return undefined;
  let resolved: PdfValue | undefined;
  try {
    resolved = await document.resolveValue(value, signal);
  } catch (error) {
    rethrowCriticalMetadataError(error, signal);
    diagnostics.push({
      code: "metadata.invalid-language",
      severity: "warning",
      message: "The catalog /Lang entry could not be resolved and was ignored."
    });
    return undefined;
  }
  const decoded = decodeDocumentString(resolved);
  if (decoded === undefined) {
    diagnostics.push({
      code: "metadata.invalid-language",
      severity: "warning",
      message: "The catalog /Lang entry is not a valid text string and was ignored."
    });
    return undefined;
  }
  return decoded;
}

async function readDocumentMetadata(
  document: NativePdfDocument,
  trailers: readonly PdfDictionary[],
  diagnostics: PdfDiagnostic[],
  signal?: AbortSignal
): Promise<Readonly<NativePdfDocumentMetadata>> {
  const value = newestTrailerValue(trailers, "Info");
  if (value === undefined) return Object.freeze({});
  let resolved: PdfValue | undefined;
  try {
    resolved = await document.resolveValue(value, signal);
  } catch (error) {
    rethrowCriticalMetadataError(error, signal);
    diagnostics.push({
      code: "metadata.invalid-info",
      severity: "warning",
      message: "The trailer /Info entry could not be resolved and was ignored."
    });
    return Object.freeze({});
  }
  if (!isPdfDictionary(resolved)) {
    diagnostics.push({
      code: "metadata.invalid-info",
      severity: "warning",
      message: "The trailer /Info entry is not a dictionary and was ignored."
    });
    return Object.freeze({});
  }
  const metadata: Record<string, string> = {};
  for (const [pdfKey, publicKey] of INFO_METADATA_KEYS) {
    let field: PdfValue | undefined;
    try {
      field = await document.resolveValue(resolved.get(pdfKey), signal);
    } catch (error) {
      rethrowCriticalMetadataError(error, signal);
      diagnostics.push({
        code: "metadata.invalid-field",
        severity: "warning",
        message: `The document /Info /${pdfKey} field could not be resolved and was ignored.`,
        details: { field: pdfKey, reason: "unresolvable" }
      });
      continue;
    }
    if (field === undefined || field === null) continue;
    const decoded = decodeDocumentString(field);
    if (decoded === undefined) {
      diagnostics.push({
        code: "metadata.invalid-field",
        severity: "warning",
        message: `The document /Info /${pdfKey} field is not a valid text string and was ignored.`,
        details: { field: pdfKey, reason: "text-string" }
      });
      continue;
    }
    if ((pdfKey === "CreationDate" || pdfKey === "ModDate") && !isValidPdfDate(decoded)) {
      diagnostics.push({
        code: "metadata.invalid-field",
        severity: "warning",
        message: `The document /Info /${pdfKey} field is not a valid PDF date and was ignored.`,
        details: { field: pdfKey, reason: "date-syntax" }
      });
      continue;
    }
    metadata[publicKey] = decoded;
  }
  return Object.freeze(metadata);
}

async function readDocumentFingerprint(
  document: NativePdfDocument,
  trailers: readonly PdfDictionary[],
  diagnostics: PdfDiagnostic[],
  signal?: AbortSignal
): Promise<string | undefined> {
  const value = newestTrailerValue(trailers, "ID");
  if (value === undefined) return undefined;
  let resolved: PdfValue | undefined;
  try {
    resolved = await document.resolveValue(value, signal);
  } catch (error) {
    rethrowCriticalMetadataError(error, signal);
    diagnostics.push({
      code: "metadata.invalid-id",
      severity: "warning",
      message: "The trailer /ID entry could not be resolved and was ignored."
    });
    return undefined;
  }
  if (!Array.isArray(resolved) || resolved.length !== 2) {
    diagnostics.push({
      code: "metadata.invalid-id",
      severity: "warning",
      message: "The trailer /ID entry is invalid and was ignored."
    });
    return undefined;
  }
  const identifiers: PdfString[] = [];
  for (let index = 0; index < resolved.length; index += 1) {
    let identifier: PdfValue | undefined;
    try {
      identifier = await document.resolveValue(resolved[index], signal);
    } catch (error) {
      rethrowCriticalMetadataError(error, signal);
      identifier = undefined;
    }
    if (!isPdfString(identifier) || identifier.bytes.length === 0) {
      diagnostics.push({
        code: "metadata.invalid-id",
        severity: "warning",
        message: "The trailer /ID array must contain exactly two non-empty byte strings and was ignored.",
        details: { entryIndex: index }
      });
      return undefined;
    }
    identifiers.push(identifier);
  }
  let output = "";
  for (const byte of identifiers[0].bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function newestTrailerValue(
  trailers: readonly PdfDictionary[],
  key: string
): PdfValue | undefined {
  for (const trailer of trailers) {
    const value = trailer.get(key);
    // Incremental trailers inherit absent keys. An explicit null has the same
    // semantics as an absent key for these document-level entries.
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function decodeDocumentString(value: PdfValue | undefined): string | undefined {
  if (!isPdfString(value)) return undefined;
  const bytes = value.bytes;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16(bytes.subarray(2), false);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeUtf16(bytes.subarray(2), true);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3));
    } catch {
      return undefined;
    }
  }
  return decodePdfDocEncoding(bytes);
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string | undefined {
  if (bytes.length % 2 !== 0) return undefined;
  let output = "";
  for (let index = 0; index < bytes.length; index += 2) {
    const codeUnit = littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1];
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 3 >= bytes.length) return undefined;
      const low = littleEndian
        ? bytes[index + 2] | (bytes[index + 3] << 8)
        : (bytes[index + 2] << 8) | bytes[index + 3];
      if (low < 0xdc00 || low > 0xdfff) return undefined;
      output += String.fromCharCode(codeUnit, low);
      index += 2;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return undefined;
    output += String.fromCharCode(codeUnit);
  }
  return output;
}

function isValidPdfDate(value: string): boolean {
  const body = value.startsWith("D:") ? value.slice(2) : value;
  let datePart = body;
  let zonePart = "";
  for (let index = 4; index < body.length; index += 1) {
    const character = body[index];
    if (character === "Z" || character === "+" || character === "-") {
      datePart = body.slice(0, index);
      zonePart = body.slice(index);
      break;
    }
  }
  if (!/^\d+$/.test(datePart) || ![4, 6, 8, 10, 12, 14].includes(datePart.length)) {
    return false;
  }
  const year = Number(datePart.slice(0, 4));
  if (year < 1 || year > 9999) return false;
  const readPart = (offset: number): number | null =>
    datePart.length >= offset + 2 ? Number(datePart.slice(offset, offset + 2)) : null;
  const month = readPart(4);
  const day = readPart(6);
  const hour = readPart(8);
  const minute = readPart(10);
  const second = readPart(12);
  if (month !== null && (month < 1 || month > 12)) return false;
  if (day !== null) {
    const daysInMonth = pdfDateDaysInMonth(year, month as number);
    if (day < 1 || day > daysInMonth) return false;
  }
  if (hour !== null && (hour < 0 || hour > 23)) return false;
  if (minute !== null && (minute < 0 || minute > 59)) return false;
  if (second !== null && (second < 0 || second > 59)) return false;
  if (zonePart === "") return true;
  if (zonePart === "Z") return true;
  const zone = /^([+-])(\d{2})(?:'?(\d{2})'?)?$/.exec(zonePart);
  if (!zone) return false;
  const zoneHour = Number(zone[2]);
  const zoneMinute = zone[3] === undefined ? 0 : Number(zone[3]);
  return zoneHour <= 23 && zoneMinute <= 59;
}

function pdfDateDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function rethrowCriticalMetadataError(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw error;
  if (
    error instanceof PdfError &&
    (error.code === "invalid-object" ||
      error.code === "invalid-xref" ||
      error.code === "unexpected-eof")
  ) return;
  throw error;
}

function copyPdfDiagnostic(diagnostic: PdfDiagnostic): PdfDiagnostic {
  return Object.freeze({
    ...diagnostic,
    ...(diagnostic.details
      ? { details: Object.freeze({ ...diagnostic.details }) }
      : {})
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

function decodePdfDocEncoding(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) {
    output += PDF_DOC_ENCODING[byte] ?? String.fromCharCode(byte);
  }
  return output;
}

function binaryString(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    output += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 8192)));
  }
  return output;
}
