import { waitForTextRecognition, type TextRecognitionInput, type TextRecognitionProvider } from "./textRecognition";

export interface PaddleTextRecognitionItem {
  readonly text: string;
  readonly poly: readonly (readonly number[] | { readonly x: number; readonly y: number })[];
  readonly score?: number;
}

/** Bridge implemented by a caller's local PaddleOCR runtime or worker. */
export interface PaddleTextRecognitionPrediction {
  readonly items: readonly PaddleTextRecognitionItem[];
}

export interface PaddleTextRecognitionClient<TImage = ImageData> {
  predict(input: TImage): Promise<PaddleTextRecognitionPrediction | readonly PaddleTextRecognitionPrediction[]>;
  dispose?(): void | Promise<void>;
}

export interface PaddleTextRecognitionProviderOptions<TImage = ImageData> {
  /** Owns runtime/model loading. HEPR does not import or download an OCR engine. */
  readonly loadClient: () => Promise<PaddleTextRecognitionClient<TImage>>;
  /** Defaults to ImageData in a browser. Workers can supply their runtime's image/Mat conversion. */
  readonly prepareImage?: (input: TextRecognitionInput) => TImage | Promise<TImage>;
  /** Releases an image created by prepareImage after prediction settles, including cancellation. */
  readonly releaseImage?: (image: TImage) => void;
}

/** Lazy adapter; creating it performs no runtime or model download. */
export function createPaddleTextRecognitionProvider<TImage = ImageData>(options: PaddleTextRecognitionProviderOptions<TImage>): TextRecognitionProvider {
  let pending: Promise<PaddleTextRecognitionClient<TImage>> | undefined;
  let disposed = false;
  let closing: Promise<void> | undefined;
  return {
    async recognize(input) {
      input.signal.throwIfAborted();
      if (disposed) throw new DOMException("Text recognition provider disposed.", "AbortError");
      if (!pending) {
        const loading = Promise.resolve().then(options.loadClient);
        pending = loading;
        void loading.catch(() => { if (pending === loading && !disposed) pending = undefined; });
      }
      const client = await waitForTextRecognition(pending, input.signal);
      input.signal.throwIfAborted();
      if (disposed) throw new DOMException("Text recognition provider disposed.", "AbortError");
      const image = options.prepareImage ? await options.prepareImage(input) : (() => {
        if (typeof ImageData === "undefined") throw new Error("PaddleOCR requires prepareImage outside a browser with ImageData.");
        return new ImageData(new Uint8ClampedArray(input.rgba), input.width, input.height) as TImage;
      })();
      if (input.signal.aborted || disposed) {
        options.releaseImage?.(image);
        input.signal.throwIfAborted();
        throw new DOMException("Text recognition provider disposed.", "AbortError");
      }
      let prediction: Promise<PaddleTextRecognitionPrediction | readonly PaddleTextRecognitionPrediction[]>;
      try { prediction = client.predict(image); }
      catch (error) { options.releaseImage?.(image); throw error; }
      const released = prediction.finally(() => options.releaseImage?.(image));
      const output = await waitForTextRecognition(released, input.signal);
      const predictions: readonly PaddleTextRecognitionPrediction[] = Array.isArray(output) ? output : [output as PaddleTextRecognitionPrediction];
      if (predictions.some(result => !result || !Array.isArray(result.items))) throw new Error("PaddleOCR prediction must contain items.");
      const items = predictions.flatMap(result => result.items);
      return { lines: items.map(item => ({ text: item.text, polygon: item.poly.map(point =>
        Array.isArray(point) ? [point[0], point[1]] as const : [(point as { x: number }).x, (point as { y: number }).y] as const) })) };
    },
    dispose() {
      disposed = true;
      return closing ??= pending ? pending.then(async client => { await client.dispose?.(); }, () => {}) : Promise.resolve();
    }
  };
}
