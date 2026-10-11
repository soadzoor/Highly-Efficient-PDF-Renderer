import { requireNativeFontPostScriptJpxCodec } from "./nativeFontPostScriptCodecs";
import { PdfError, throwIfAborted } from "./nativeTypes";

/** Ghostscript's JPXDecode extension returns packed, row-padded color samples
 * or an alpha plane. Keep the source precision rather than using PDF's eight-bit
 * display bridge. Twelve-bit samples occupy sixteen bits, most significant first. */
export function decodeNativeFontPostScriptJpx(encoded: Uint8Array, parameters: {
  readonly Alpha?: boolean; readonly ColorSpace?: string;
}, maxBytes: number, signal?: AbortSignal): Uint8Array {
  throwIfAborted(signal);
  const { decodeBundledJpxRawSync, readJpxProperties } = requireNativeFontPostScriptJpxCodec();
  const properties = readJpxProperties(encoded), { components } = properties;
  const width = Math.max(...properties.samples.map(sample => sample.width)), height = Math.max(...properties.samples.map(sample => sample.height));
  const precision = properties.samples[0].precision, bits = precision === 12 ? 16 : precision;
  if (![1, 2, 4, 8, 16].includes(bits) || properties.samples.some(sample => sample.precision !== precision)) {
    throw error("Unsupported or mixed JPX font sample precision.");
  }
  let alpha = -1, colorCount = components, ycc = false;
  const associations = new Map<number, number>();
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
          const channel = view.getUint16(offset), kind = view.getUint16(offset + 2), association = view.getUint16(offset + 4);
          if (channel >= components) throw error("Invalid JPX channel index.");
          if (kind === 1 || kind === 2) {
            if (alpha !== -1 && alpha !== channel) throw error("Multiple JPX font alpha channels require a fallback.");
            alpha = channel;
          } else if (kind === 0 && association > 0 && association !== 65535) associations.set(channel, association);
        }
      } else if (type === 0x636f6c72 && body + 7 <= limit && encoded[body] === 1) { // enumerated colr
        const space = view.getUint32(body + 3);
        if (space === 17) colorCount = 1;
        else if (space === 16) colorCount = 3;
        else if (space === 18 || space === 24) { colorCount = 3; ycc = true; }
      } else if ((type === 0x70636c72 || type === 0x636d6170) && parameters.ColorSpace !== "Indexed") {
        throw error("Paletted JPX font colors require a channel-mapping fallback.");
      }
      start = limit;
    }
  };
  if (encoded[0] !== 0xff || encoded[1] !== 0x4f) boxes(0, encoded.length);
  // Indexed decoding ignores JP2 palette/channel definitions, as in Ghostscript.
  if (parameters.ColorSpace === "Indexed") { alpha = -1; associations.clear(); colorCount = components; ycc = false; }
  const colorChannels = Array.from({ length: components }, (_, index) => index).filter(channel => channel !== alpha)
    .sort((a, b) => (associations.get(a) ?? a + 1) - (associations.get(b) ?? b + 1))
    .slice(0, colorCount);
  const channels = parameters.Alpha ? 1 : colorChannels.length;
  const rowBytes = Math.ceil(width * channels * bits / 8), outputBytes = rowBytes * height;
  if (!Number.isSafeInteger(outputBytes) || outputBytes > maxBytes) {
    throw new PdfError("resource-limit", "JPX font output exceeds the configured decoded-file byte limit.");
  }
  return decodeBundledJpxRawSync(encoded, planes => {
    const result = new Uint8Array(outputBytes);
    if (parameters.Alpha && alpha < 0) { result.fill(255); return result; }
    const selected = parameters.Alpha ? [alpha] : colorChannels;
    const sameScale = properties.samples.every(sample => sample.dx === properties.samples[0].dx && sample.dy === properties.samples[0].dy);
    const values = Array(selected.length).fill(0), maximum = 2 ** bits - 1;
    for (let y = 0; y < height; y++) {
      throwIfAborted(signal);
      let bit = y * rowBytes * 8;
      for (let x = 0; x < width; x++) {
        for (let index = 0; index < selected.length; index++) {
          const channel = selected[index], sample = properties.samples[channel];
          const sx = sameScale ? x : Math.min(sample.width - 1, Math.floor(x / sample.dx));
          const sy = sameScale ? y : Math.min(sample.height - 1, Math.floor(y / sample.dy));
          values[index] = (planes[channel][sy * sample.width + sx] + (sample.signed ? 2 ** (precision - 1) : 0)) * 2 ** (bits - precision);
        }
        if (ycc && components === 3 && !parameters.Alpha) {
          if (bits < 8 || values.length !== 3) throw error("Invalid YCC JPX font sample layout.");
          const luminance = values[0], blue = values[1] - 2 ** (bits - 1), red = values[2] - 2 ** (bits - 1);
          values[0] = Math.max(0, Math.min(maximum, Math.trunc(luminance + 1.402 * red)));
          values[1] = Math.max(0, Math.min(maximum, Math.trunc(luminance - .34413 * blue - .71414 * red)));
          values[2] = Math.max(0, Math.min(maximum, Math.trunc(luminance + 1.772 * blue)));
        }
        for (const value of values) {
          if (bits === 16) { result[bit / 8] = value >>> 8; result[bit / 8 + 1] = value & 255; }
          else if (bits === 8) result[bit / 8] = value;
          else result[Math.floor(bit / 8)] |= (value & (2 ** bits - 1)) << (8 - bits - bit % 8);
          bit += bits;
        }
      }
    }
    return result;
  }, signal);
}
function error(message: string): PdfError {
  return new PdfError("unsupported-image", message, { details: { codec: "jpeg2000", reason: "unsupported-jpx-font-layout" } });
}
