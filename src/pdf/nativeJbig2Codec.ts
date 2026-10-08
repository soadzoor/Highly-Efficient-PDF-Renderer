import type { NativeImageCodecRequest, NativeImageCodecResult } from "./nativeImage";
import { PdfError, throwIfAborted } from "./nativeTypes";
import { JBIG2_MAX_WORK, preflightJbig2, stripJbig2FileHeader } from "./codecs/jbig2Preflight";
import { tryDecodeJbig2Symbols } from "./codecs/jbig2SymbolKernel";
import { decodePdfiumJbig2 } from "./codecs/jbig2Wasm";
export { BUNDLED_JBIG2_CODEC_ASSET } from "./codecs/jbig2Wasm";

/** Decode PDF embedded JBIG2 segments, including a separate globals stream. */
export async function decodeBundledJbig2(request: Readonly<NativeImageCodecRequest>, maxBytes: number,
  signal?: AbortSignal): Promise<NativeImageCodecResult> {
  throwIfAborted(signal);
  if (request.components !== 1 || request.bitsPerComponent !== 1 ||
      !Number.isSafeInteger(request.width) || request.width <= 0 ||
      !Number.isSafeInteger(request.height) || request.height <= 0) {
    throw codecError("Invalid JBIG2 dimensions or sample layout.", "invalid-request");
  }
  const outputBytes = Math.ceil(request.width / 8) * request.height;
  if (!Number.isSafeInteger(outputBytes) || outputBytes + request.encoded.length + request.globals.length > maxBytes) {
    throw new PdfError("resource-limit", "JBIG2 input and output exceed the configured stream limit.", {
      details: { codec: "jbig2", reason: "jbig2-working-set", limit: maxBytes }
    });
  }
  try {
    const encoded = stripJbig2FileHeader(request.encoded), globals = stripJbig2FileHeader(request.globals);
    const work = preflightJbig2(encoded, globals, request.width, request.height, maxBytes, signal);
    const symbolic = tryDecodeJbig2Symbols(encoded, globals, request.width, request.height, maxBytes, signal, JBIG2_MAX_WORK - work);
    const samples = symbolic.result?.samples ?? await decodePdfiumJbig2(encoded, globals, request.width, request.height, maxBytes, signal,
      JBIG2_MAX_WORK - work - symbolic.work);
    throwIfAborted(signal);
    if (samples.length !== outputBytes) throw codecError("JBIG2 dimensions disagree with the PDF image.", "dimension-mismatch");
    return { samples, width: request.width, height: request.height, components: 1, bitsPerComponent: 1,
      ...(symbolic.result ? { jbig2Symbols: symbolic.result.jbig2Symbols } : {}) };
  } catch (cause) {
    throwIfAborted(signal);
    if (cause instanceof PdfError) throw cause;
    throw codecError("Unable to decode the JBIG2 image.", "invalid-jbig2-data", cause);
  }
}

function codecError(message: string, reason: string, cause?: unknown): PdfError {
  return new PdfError("unsupported-image", message, { cause, details: { codec: "jbig2", reason } });
}
