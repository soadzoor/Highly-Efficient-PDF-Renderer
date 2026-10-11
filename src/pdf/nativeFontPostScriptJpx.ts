import { decodeBundledJpxSync, readJpxProperties } from "./nativeJpxCodec";
import { PdfError, throwIfAborted } from "./nativeTypes";

/** Ghostscript's JPXDecode extension returns color samples or a separate alpha
 * plane. The PDF bridge emits bytes, so other precisions need a diagnosed
 * fallback rather than silently changing the PostScript readstring layout. */
export function decodeNativeFontPostScriptJpx(encoded: Uint8Array, parameters: {
  readonly Alpha?: boolean; readonly ColorSpace?: string;
}, maxBytes: number, signal?: AbortSignal): Uint8Array {
  throwIfAborted(signal);
  const properties = readJpxProperties(encoded), { width, height, components } = properties;
  if (!properties.unsignedBytes) throw error("JPX font filters currently require unsigned eight-bit samples.");
  let alpha = -1;
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const boxes = (start: number, end: number): void => {
    while (start < end) {
      throwIfAborted(signal);
      if (start + 8 > end) throw error("Truncated JPX box header.");
      let length = view.getUint32(start), header = 8;
      const type = view.getUint32(start + 4);
      if (length === 1) {
        if (start + 16 > end) throw error("Truncated JPX extended box header.");
        const large = view.getBigUint64(start + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw error("Invalid JPX box length.");
        length = Number(large); header = 16;
      } else if (length === 0) length = end - start;
      if (length < header || start + length > end) throw error("Invalid JPX box extent.");
      const body = start + header, limit = start + length;
      if (type === 0x6a703268) boxes(body, limit); // jp2h
      else if (type === 0x63646566) { // cdef
        if (body + 2 > limit) throw error("Truncated JPX channel definitions.");
        const count = view.getUint16(body);
        if (body + 2 + count * 6 !== limit) throw error("Invalid JPX channel definitions.");
        for (let offset = body + 2; offset < limit; offset += 6) {
          const channel = view.getUint16(offset), kind = view.getUint16(offset + 2);
          if (channel >= components) throw error("Invalid JPX channel index.");
          if (kind === 2) throw error("Premultiplied JPX font alpha requires an explicit fallback.");
          if (kind === 1) {
            if (alpha !== -1 || channel !== components - 1) throw error("Unsupported JPX font alpha placement.");
            alpha = channel;
          }
        }
      }
      start = limit;
    }
  };
  if (encoded[0] !== 0xff || encoded[1] !== 0x4f) boxes(0, encoded.length);
  if (components === 2 && alpha < 0) throw error("A two-component JPX font image requires an alpha definition.");
  const channels = parameters.Alpha ? 1 : components - (alpha < 0 ? 0 : 1);
  const outputBytes = width * height * channels;
  if (!Number.isSafeInteger(outputBytes) || outputBytes > maxBytes) {
    throw new PdfError("resource-limit", "JPX font output exceeds the configured decoded-file byte limit.");
  }
  const samples = decodeBundledJpxSync({ codec: "jpeg2000", encoded, globals: new Uint8Array(), width, height, components,
    bitsPerComponent: 8, imageMask: false, decodeParameters: alpha < 0 ? {} : { SMaskInData: 1 },
    indexedColorSpace: parameters.ColorSpace === "Indexed" }, Number.MAX_SAFE_INTEGER, signal).samples;
  if (!parameters.Alpha && alpha < 0) return samples;
  const result = new Uint8Array(outputBytes);
  for (let pixel = 0; pixel < width * height; pixel++) {
    if ((pixel & 255) === 0) throwIfAborted(signal);
    if (parameters.Alpha) result[pixel] = alpha < 0 ? 255 : samples[pixel * components + alpha];
    else for (let channel = 0; channel < channels; channel++) result[pixel * channels + channel] = samples[pixel * components + channel];
  }
  return result;
}
function error(message: string): PdfError {
  return new PdfError("unsupported-image", message, { details: { codec: "jpeg2000", reason: "unsupported-jpx-font-layout" } });
}
