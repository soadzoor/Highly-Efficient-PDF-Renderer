/** Small binary-safe PDF object writer shared by document editing exporters. */
const encoder = new TextEncoder();

export function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("PDF numbers must be finite.");
  if (Object.is(value, -0) || value === 0) return "0";
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  // PDF numbers do not support exponent notation. Preserve the shortest
  // round-trippable decimal rather than rounding small geometry to zero.
  const [coefficient, exponent] = text.toLowerCase().split("e"), negative = coefficient.startsWith("-");
  const digits = coefficient.replace(/[-.]/g, ""), point = (coefficient.replace("-", "").indexOf(".") < 0
    ? coefficient.replace("-", "").length : coefficient.replace("-", "").indexOf(".")) + Number(exponent);
  return `${negative ? "-" : ""}${point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length
    ? `${digits}${"0".repeat(point - digits.length)}` : `${digits.slice(0, point)}.${digits.slice(point)}`}`;
}

export function pdfRef(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError("Invalid PDF object reference.");
  return `${number} 0 R`;
}

export function pdfName(value: string): string {
  return `/${Array.from(encoder.encode(value), byte => byte >= 33 && byte <= 126 && !"#%()/<>[]{}".includes(String.fromCharCode(byte))
    ? String.fromCharCode(byte) : `#${byte.toString(16).padStart(2, "0")}`).join("")}`;
}

/** Hexadecimal UTF-16BE PDF string, including the byte-order mark. */
export function pdfUtf16Hex(value: string): string {
  let text = "feff";
  for (let index = 0; index < value.length; index++) text += value.charCodeAt(index).toString(16).padStart(4, "0");
  return `<${text}>`;
}

export function joinPdfBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  if (!Number.isSafeInteger(length)) throw new RangeError("PDF output exceeds addressable byte storage.");
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

export function pdfStreamBytes(data: string | Uint8Array, dictionaryEntries = ""): Uint8Array {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return joinPdfBytes([encoder.encode(`<< /Length ${bytes.length}${dictionaryEntries ? ` ${dictionaryEntries}` : ""} >>\nstream\n`),
    bytes, encoder.encode("\nendstream")]);
}

export class PdfByteWriter {
  private readonly objects: (Uint8Array | undefined)[] = [];
  readonly signal?: AbortSignal;

  constructor(options: { signal?: AbortSignal } = {}) { this.signal = options.signal; }
  reserve(): number { this.signal?.throwIfAborted(); this.objects.push(undefined); return this.objects.length; }
  set(number: number, body: string | Uint8Array): void {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(number) || number < 1 || number > this.objects.length || this.objects[number - 1] !== undefined) {
      throw new RangeError("PDF object must be reserved and assigned exactly once.");
    }
    this.objects[number - 1] = typeof body === "string" ? encoder.encode(body) : body;
  }
  add(body: string | Uint8Array): number { const number = this.reserve(); this.set(number, body); return number; }

  async stream(data: string | Uint8Array, dictionaryEntries = "", compress = true): Promise<number> {
    this.signal?.throwIfAborted();
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    if (compress && bytes.length && typeof CompressionStream === "function") {
      const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate"));
      const packed = new Uint8Array(await new Response(stream).arrayBuffer());
      this.signal?.throwIfAborted();
      if (packed.length < bytes.length) return this.add(pdfStreamBytes(packed, `${dictionaryEntries} /Filter /FlateDecode`));
    }
    return this.add(pdfStreamBytes(bytes, dictionaryEntries));
  }

  build(root: number, extraTrailerEntries = ""): Uint8Array {
    this.signal?.throwIfAborted(); pdfRef(root);
    if (root > this.objects.length) throw new RangeError("Unknown PDF root object.");
    const parts: Uint8Array[] = [Uint8Array.of(37, 80, 68, 70, 45, 49, 46, 55, 10, 37, 128, 129, 130, 131, 10)], offsets = [0];
    let length = parts[0].length;
    this.objects.forEach((body, index) => {
      this.signal?.throwIfAborted();
      if (!body) throw new Error(`PDF object ${index + 1} was reserved without a body.`);
      if (length > 9_999_999_999) throw new RangeError("PDF output exceeds the classic cross-reference offset format.");
      offsets.push(length);
      const prefix = encoder.encode(`${index + 1} 0 obj\n`), suffix = encoder.encode("\nendobj\n");
      parts.push(prefix, body, suffix); length += prefix.length + body.length + suffix.length;
    });
    const table = [`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`];
    for (let index = 1; index < offsets.length; index++) table.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
    table.push(`trailer\n<< /Size ${offsets.length} /Root ${pdfRef(root)}${extraTrailerEntries ? ` ${extraTrailerEntries}` : ""} >>\nstartxref\n${length}\n%%EOF\n`);
    parts.push(encoder.encode(table.join("")));
    return joinPdfBytes(parts);
  }
}
