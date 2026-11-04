import { waitForTextRecognition, type TextRecognitionInput, type TextRecognitionProvider,
  type TextRecognitionResult } from "./textRecognition";

interface NativeDetectedText {
  readonly rawValue: string;
  readonly cornerPoints?: readonly { readonly x: number; readonly y: number }[];
  readonly boundingBox?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

interface NativeTextDetector {
  detect(image: ImageData): Promise<readonly NativeDetectedText[]>;
  destroy?(): void;
}

export interface NativeTextRecognitionProviderOptions {
  /** Receives the reason the web API is absent or its backend cannot initialize. */
  readonly onUnavailable?: (reason: unknown) => void;
}

/** Native API availability varies by browser. No engine or models are downloaded by HEPR. */
export async function createNativeTextRecognitionProvider(options: NativeTextRecognitionProviderOptions = {}): Promise<TextRecognitionProvider | null> {
  const Detector = (globalThis as typeof globalThis & {
    TextDetector?: { new (): NativeTextDetector; create?(): Promise<NativeTextDetector> };
  }).TextDetector;
  if (!Detector || typeof ImageData === "undefined") {
    options.onUnavailable?.(new Error("This browser does not expose the TextDetector API to this application."));
    return null;
  }
  let detector: NativeTextDetector | undefined;
  try {
    detector = Detector.create ? await Detector.create() : new Detector();
    if (!detector || typeof detector.detect !== "function") throw new Error("The browser did not create a usable TextDetector.");
    // Older constructors can exist even when the platform service is absent.
    // Probe a small opaque image before preparing a full-resolution scan. A
    // normal image size also works with platform OCR services that reject tiny inputs.
    if (!Detector.create) await detector.detect(new ImageData(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64));
  } catch (error) {
    try { detector?.destroy?.(); } catch { /* Preserve the original initialization failure. */ }
    options.onUnavailable?.(error);
    return null;
  }
  const readyDetector = detector;
  return {
    dispose() { readyDetector.destroy?.(); },
    async recognize(input: TextRecognitionInput): Promise<TextRecognitionResult> {
      input.signal.throwIfAborted();
      const image = new ImageData(new Uint8ClampedArray(input.rgba), input.width, input.height);
      const detected = await waitForTextRecognition(readyDetector.detect(image), input.signal);
      input.signal.throwIfAborted();
      return { lines: detected.map(item => {
        const box = item.boundingBox;
        const polygon = item.cornerPoints && item.cornerPoints.length >= 3 ? item.cornerPoints.map(point => [point.x, point.y] as const) :
          (box ? [[box.x, box.y], [box.x + box.width, box.y],
            [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]] as const : []);
        return { text: item.rawValue, polygon };
      }) };
    }
  };
}
