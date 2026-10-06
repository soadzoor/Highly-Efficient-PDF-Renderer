import { tinyPdfStream, writeTinyPdf } from "./tinyPdfWriter.mjs";

const uint32 = value => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const segment = (number, type, page, payload) => [...uint32(number), type, 0, page, ...uint32(payload.length), ...payload];

/** An 8x2 embedded JBIG2 page: white first row, black second row. */
export function tinyJbig2() {
  const page = [...uint32(8), ...uint32(2), ...uint32(0), ...uint32(0), 0, 0, 0];
  const region = [...uint32(8), ...uint32(2), ...uint32(0), ...uint32(0), 0, 1];
  // Group4: vertical0 white row; horizontal white0/black8; end-of-facsimile.
  const bits = "1" + "001" + "00110101" + "000101" + "000000000001000000000001";
  const fax = Array.from({ length: Math.ceil(bits.length / 8) }, (_, index) =>
    parseInt(bits.slice(index * 8, index * 8 + 8).padEnd(8, "0"), 2));
  return Uint8Array.from([...segment(1, 48, 1, page), ...segment(2, 38, 1, [...region, ...fax])]);
}

/** Empty Huffman symbol dictionary in a globals stream, independently parsed. */
export function tinyJbig2Globals() {
  return Uint8Array.from(segment(0, 0, 0, [0, 1, ...uint32(0), ...uint32(0)]));
}

export function imagePdf(encoded, {
  filter = "JPXDecode", width = 8, height = 8, colorSpace = "/DeviceRGB",
  bitsPerComponent = 8, extra = "", globals
} = {}) {
  const entries = [`/Type /XObject /Subtype /Image /Width ${width} /Height ${height}`,
    colorSpace && `/ColorSpace ${colorSpace}`,
    bitsPerComponent && `/BitsPerComponent ${bitsPerComponent}`, `/Filter /${filter}`, extra,
    globals && "/DecodeParms << /JBIG2Globals 6 0 R >>"].filter(Boolean).join(" ");
  const objects = [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", `q ${width} 0 0 ${height} 0 0 cm /Im Do Q`) },
    { number: 5, body: tinyPdfStream(entries, encoded) }
  ];
  if (globals) objects.push({ number: 6, body: tinyPdfStream("", globals) });
  return writeTinyPdf({ objects });
}
