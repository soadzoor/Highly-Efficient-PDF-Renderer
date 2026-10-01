/** PDFDocEncoding bytes whose characters differ from ISO Latin-1. */
const PDF_DOC_ENCODING: Readonly<Record<number, string>> = Object.freeze({
  0x18: "˘", 0x19: "ˇ", 0x1a: "ˆ", 0x1b: "˙",
  0x1c: "˝", 0x1d: "˛", 0x1e: "˚", 0x1f: "˜",
  0x80: "•", 0x81: "†", 0x82: "‡", 0x83: "…",
  0x84: "—", 0x85: "–", 0x86: "ƒ", 0x87: "⁄",
  0x88: "‹", 0x89: "›", 0x8a: "−", 0x8b: "‰",
  0x8c: "„", 0x8d: "“", 0x8e: "”", 0x8f: "‘",
  0x90: "’", 0x91: "‚", 0x92: "™", 0x93: "ﬁ",
  0x94: "ﬂ", 0x95: "Ł", 0x96: "Œ", 0x97: "Š",
  0x98: "Ÿ", 0x99: "Ž", 0x9a: "ı", 0x9b: "ł",
  0x9c: "œ", 0x9d: "š", 0x9e: "ž", 0xa0: "€"
});

const PDF_DOC_ENCODING_BYTES: ReadonlyMap<string, number> = new Map(
  Object.entries(PDF_DOC_ENCODING).map(([byte, character]) => [character, Number(byte)])
);

export function decodePdfDocEncoding(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) {
    output += PDF_DOC_ENCODING[byte] ?? String.fromCharCode(byte);
  }
  return output;
}

/**
 * Encode text in PDFDocEncoding, or return null when a character has no
 * PDFDocEncoding byte.
 */
export function encodePdfDocEncoding(text: string): Uint8Array | null {
  const output: number[] = [];
  for (const character of text) {
    const mapped = PDF_DOC_ENCODING_BYTES.get(character);
    if (mapped !== undefined) {
      output.push(mapped);
      continue;
    }
    const code = character.codePointAt(0)!;
    // Bytes PDFDocEncoding redefines (or leaves undefined) cannot stand for
    // the Latin-1 character at the same position.
    if (code > 0xff || PDF_DOC_ENCODING[code] !== undefined || code === 0x7f || code === 0x9f || code === 0xad) {
      return null;
    }
    output.push(code);
  }
  return Uint8Array.from(output);
}
