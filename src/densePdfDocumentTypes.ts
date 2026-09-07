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
