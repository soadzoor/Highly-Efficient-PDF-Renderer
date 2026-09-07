/** Sources accepted by the dependency-free PDF structure engine. */
export type PdfSource =
  | {
      readonly kind: "bytes";
      readonly bytes: Uint8Array;
      /**
       * `copy` (the default) preserves caller ownership. `transfer` relinquishes
       * the backing buffer and detaches it when the platform permits transfer.
       */
      readonly ownership?: "copy" | "transfer";
      readonly label?: string;
    }
  | { readonly kind: "blob"; readonly blob: Blob; readonly label?: string }
  | {
      readonly kind: "url";
      readonly url: string | URL;
      readonly request?: RequestInit;
      readonly label?: string;
    }
  | {
      readonly kind: "range";
      readonly byteLength: number;
      read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
      close?(): void | Promise<void>;
      readonly label?: string;
    };

export type PdfDiagnosticSeverity = "info" | "warning" | "error";

/** A stable, serializable parser diagnostic. */
export interface PdfDiagnostic {
  readonly code: string;
  readonly severity: PdfDiagnosticSeverity;
  readonly message: string;
  readonly offset?: number;
  readonly objectNumber?: number;
  readonly pageIndex?: number;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PdfResourceLimits {
  /** Maximum number of linked incremental revisions. */
  readonly maxIncrementalRevisions: number;
  /** Maximum object/page-tree recursion depth. */
  readonly maxRecursionDepth: number;
  /** Maximum result of one decoded stream. */
  readonly maxDecodedStreamBytes: number;
  /** Maximum aggregate decoded bytes retained by parsed object streams. */
  readonly maxObjectStreamCacheBytes: number;
  /** Maximum number of bytes inspected by structural repair. */
  readonly maxRepairScanBytes: number;
  /** Maximum indirect-object candidates retained by repair. */
  readonly maxRepairCandidates: number;
  /** Maximum indirect objects held by the resolver cache. */
  readonly maxCachedObjects: number;
  /** Maximum source bytes held by the random-access block cache. */
  readonly maxSourceCacheBytes: number;
  /** Maximum width or height of one decoded image. */
  readonly maxImageDimension: number;
  /** Maximum decoded pixels in one image. */
  readonly maxImagePixels: number;
  /** Maximum decoded bytes retained for one ICC profile. */
  readonly maxIccProfileBytes: number;
  /** Maximum combined input/output bytes for one ICC transform lattice. */
  readonly maxIccTransformBytes: number;
  /** Maximum ordered display commands emitted for one page. */
  readonly maxCommandsPerPage: number;
  /** Maximum path resources emitted for one page. */
  readonly maxPathsPerPage: number;
  /** Maximum retained path verbs emitted for one page and its programs. */
  readonly maxPathVerbsPerPage: number;
  /** Maximum retained path coordinates emitted for one page and its programs. */
  readonly maxPathCoordinatesPerPage: number;
  /** Maximum persistent clip nodes emitted for one page and its programs. */
  readonly maxClipsPerPage: number;
  /** Maximum generic stroke styles emitted for one page and its programs. */
  readonly maxStrokeStylesPerPage: number;
  /** Maximum dash-array values emitted for one page and its programs. */
  readonly maxDashValuesPerPage: number;
  /** Maximum positioned glyphs indexed for one page. */
  readonly maxGlyphsPerPage: number;
}

export const DEFAULT_PDF_RESOURCE_LIMITS: Readonly<PdfResourceLimits> = Object.freeze({
  maxIncrementalRevisions: 128,
  maxRecursionDepth: 64,
  maxDecodedStreamBytes: 512 * 1024 * 1024,
  maxObjectStreamCacheBytes: 512 * 1024 * 1024,
  maxRepairScanBytes: 512 * 1024 * 1024,
  maxRepairCandidates: 2_000_000,
  maxCachedObjects: 16_384,
  maxSourceCacheBytes: 32 * 1024 * 1024,
  maxImageDimension: 65_535,
  maxImagePixels: 268_435_456,
  maxIccProfileBytes: 64 * 1024 * 1024,
  maxIccTransformBytes: 16 * 1024 * 1024,
  maxCommandsPerPage: 10_000_000,
  maxPathsPerPage: 5_000_000,
  maxPathVerbsPerPage: 20_000_000,
  maxPathCoordinatesPerPage: 60_000_000,
  maxClipsPerPage: 1_000_000,
  maxStrokeStylesPerPage: 5_000_000,
  maxDashValuesPerPage: 20_000_000,
  maxGlyphsPerPage: 10_000_000
});

export type PdfErrorCode =
  | "aborted"
  | "closed"
  | "encrypted"
  | "invalid-header"
  | "invalid-page-index"
  | "invalid-xref"
  | "invalid-object"
  | "invalid-page-tree"
  | "unsupported-content"
  | "unsupported-font"
  | "unsupported-image"
  | "unsupported-color"
  | "unsupported-filter"
  | "worker-crash"
  | "incompatible-format"
  | "resource-limit"
  | "source-changed"
  | "source-read"
  | "unexpected-eof";

/** Typed error crossing the public parser/worker boundary. */
export class PdfError extends Error {
  readonly code: PdfErrorCode;
  readonly offset?: number;
  readonly objectNumber?: number;
  readonly pageIndex?: number;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: PdfErrorCode,
    message: string,
    options: {
      cause?: unknown;
      offset?: number;
      objectNumber?: number;
      pageIndex?: number;
      details?: Readonly<Record<string, string | number | boolean | null>>;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PdfError";
    this.code = code;
    this.offset = options.offset;
    this.objectNumber = options.objectNumber;
    this.pageIndex = options.pageIndex;
    this.details = options.details;
  }
}

export function mergePdfLimits(
  overrides?: Partial<PdfResourceLimits>
): Readonly<PdfResourceLimits> {
  if (!overrides) {
    return DEFAULT_PDF_RESOURCE_LIMITS;
  }
  const result: PdfResourceLimits = { ...DEFAULT_PDF_RESOURCE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`PDF resource limit ${name} must be a positive safe integer.`);
    }
  }
  return Object.freeze(result);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PdfError("aborted", "The PDF operation was aborted.", { cause: signal.reason });
  }
}
