import { prepareBundledJpegCodec } from "./nativeJpegCodec";
import { PdfError, throwIfAborted } from "./nativeTypes";

type FontJpxCodec = Pick<typeof import("./nativeJpxCodec"), "readJpxProperties" | "decodeBundledJpxRawSync">;
type FontJbig2Codec = Pick<typeof import("./nativeJbig2Codec"), "decodeBundledJbig2Sync">;
let jpxCodec: FontJpxCodec | undefined;
let jbig2Codec: FontJbig2Codec | undefined;

/** Async PDF font preparation loads the optional adapters before synchronous
 * PostScript execution, without adding them to the initial parser graph. */
export async function prepareNativeFontPostScriptCodecs(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await Promise.all([
    prepareBundledJpegCodec(signal),
    prepareOptionalCodec("jpeg2000", async () => (await import("./nativeJpxCodec")).prepareBundledJpxCodec(signal), signal),
    prepareOptionalCodec("jbig2", async () => (await import("./nativeJbig2Codec")).prepareBundledJbig2Codec(signal), signal)
  ]);
}

async function prepareOptionalCodec(codec: string, prepare: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  try { await prepare(); }
  catch (cause) {
    throwIfAborted(signal);
    if (cause instanceof PdfError) throw cause;
    throw new PdfError("unsupported-image", "Unable to load the optional font image codec.", {
      cause, details: { codec, reason: "codec-load-failed" }
    });
  }
}

export function registerNativeFontPostScriptJpxCodec(codec: FontJpxCodec): void { jpxCodec = codec; }
export function registerNativeFontPostScriptJbig2Codec(codec: FontJbig2Codec): void { jbig2Codec = codec; }

export function requireNativeFontPostScriptJpxCodec(): FontJpxCodec {
  if (!jpxCodec) throw notPrepared("jpeg2000");
  return jpxCodec;
}

export function requireNativeFontPostScriptJbig2Codec(): FontJbig2Codec {
  if (!jbig2Codec) throw notPrepared("jbig2");
  return jbig2Codec;
}

function notPrepared(codec: string): PdfError {
  return new PdfError("unsupported-image", "The image codec must be prepared before synchronous font decoding.", {
    details: { codec, reason: "codec-not-prepared" }
  });
}
