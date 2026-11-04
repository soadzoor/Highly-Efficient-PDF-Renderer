/** Pixel-space polygons, in top-to-bottom input row order. */
export type TextRecognitionPolygon = readonly (readonly [number, number])[];

export interface TextRecognitionCharacter {
  readonly text: string;
  readonly polygon: TextRecognitionPolygon;
}

export interface TextRecognitionLine extends TextRecognitionCharacter {
  readonly characters?: readonly TextRecognitionCharacter[];
}

export interface TextRecognitionResult {
  /** Lines in reading order. Providers should preserve word spaces. */
  readonly lines: readonly TextRecognitionLine[];
}

export interface TextRecognitionInput {
  readonly width: number;
  readonly height: number;
  /** Owned, straight-alpha RGBA8 pixels. A provider must not modify them. */
  readonly rgba: Uint8Array;
  readonly sourcePageIndex: number;
  readonly languages: readonly string[];
  readonly signal: AbortSignal;
}

export interface TextRecognitionProvider {
  recognize(input: TextRecognitionInput): Promise<TextRecognitionResult>;
  dispose?(): void | Promise<void>;
}

export interface TextRecognitionProgress {
  readonly state: "idle" | "recognizing" | "complete" | "failed" | "unavailable" | "paused" | "disposed";
  readonly completed: number;
  readonly total: number;
  /** Completed pages with usable recognized text; a completed scan can be blank. */
  readonly recognizedPages?: number;
  readonly pageIndex?: number;
  readonly sourcePageIndex?: number;
  /** Engine actually selected; browser initialization can precede this value. */
  readonly provider?: "native" | "fallback" | "custom";
  readonly stage?: "initializing" | "rendering" | "recognizing";
}

export interface TextRecognitionOptions {
  /** Caller-owned recognizer. Omitted probes the browser's native TextDetector. */
  readonly provider?: TextRecognitionProvider;
  /** Lazily creates a local fallback, owned and disposed by the document. */
  readonly fallback?: () => Promise<TextRecognitionProvider | null>;
  /** Recognition resolution in dots per inch. @default 300 */
  readonly dpi?: number;
  readonly languages?: readonly string[];
  readonly onProgress?: (state: TextRecognitionProgress) => void;
}

export type TextRecognitionSetting = "off" | "auto" | TextRecognitionOptions;

/** Wait without allowing an uncooperative provider to delay document disposal. @internal */
export function waitForTextRecognition<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    pending.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
