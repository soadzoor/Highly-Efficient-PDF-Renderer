import { isPdfDictionary, isPdfName, isPdfRef, isPdfStream, isPdfString,
  type PdfDictionary, type PdfRef, type PdfValue } from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import { createPdfPasswordProtection, validatePdfOutputProtection, type PdfOutputProtection } from "./pdfProtection";

export type { PdfOutputProtection } from "./pdfProtection";
export interface NativePdfSaveOptions {
  readonly protection?: PdfOutputProtection;
  /** @internal Serialize the final reachable graph without retaining historical revisions. */
  readonly rewrite?: boolean;
  /** @internal Authenticated source handler to retain when rebuilding a fresh/flattened PDF. */
  readonly encryptionSource?: NativePdfDocument;
}

const encoder = new TextEncoder();
export const pdfNameValue = (value: string): PdfValue => ({ kind: "name", value });
export const pdfReference = (objectNumber: number, generation = 0): PdfRef => ({ kind: "ref", objectNumber, generation });
export function pdfTextValue(text: string): PdfValue {
  const bytes = new Uint8Array(text.length * 2 + 2); bytes.set([254, 255]);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2 + 2, text.charCodeAt(i));
  return { kind: "string", hex: true, bytes };
}
export function pdfAsciiValue(text: string): PdfValue {
  return { kind: "string", hex: true, bytes: encoder.encode(text) };
}
export function pdfStreamValue(bytes: Uint8Array | string, dictionary: PdfDictionary = new Map()): PdfValue {
  return { kind: "stream", dictionary, bytes: typeof bytes === "string" ? encoder.encode(bytes) : bytes };
}
export function pdfNumberValue(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError("PDF numbers must be finite.");
  if (Object.is(value, -0)) return "0";
  const text = String(value);
  if (!/e/i.test(text)) return text;
  const [mantissa, exponent] = text.toLowerCase().split("e");
  const sign = mantissa.startsWith("-") ? "-" : "";
  const parts = mantissa.replace("-", "").split(".");
  const digits = parts.join(""); const position = parts[0].length + Number(exponent);
  return sign + (position <= 0 ? "0." + "0".repeat(-position) + digits
    : position >= digits.length ? digits + "0".repeat(position - digits.length)
      : digits.slice(0, position) + "." + digits.slice(position));
}
export function serializePdfValue(value: PdfValue): Uint8Array {
  const chunks: Uint8Array[] = [];
  const text = (v: string) => chunks.push(encoder.encode(v));
  const write = (v: PdfValue): void => {
    if (v === null) text("null");
    else if (typeof v === "boolean") text(String(v));
    else if (typeof v === "number") text(pdfNumberValue(v));
    else if (isPdfName(v)) text("/" + [...v.value].flatMap(character => character.codePointAt(0)! <= 255
      ? [character.charCodeAt(0)] : [...encoder.encode(character)]).map(byte =>
      byte >= 33 && byte <= 126 && !"#%()/<>[]{}".includes(String.fromCharCode(byte))
        ? String.fromCharCode(byte) : "#" + byte.toString(16).padStart(2, "0")).join(""));
    else if (isPdfRef(v)) text(`${v.objectNumber} ${v.generation} R`);
    else if (isPdfString(v)) text("<" + [...v.bytes].map(byte => byte.toString(16).padStart(2, "0")).join("") + ">");
    else if (Array.isArray(v)) { text("["); for (const item of v) { write(item); text(" "); } text("]"); }
    else if (isPdfStream(v)) {
      const d = new Map(v.dictionary); d.set("Length", v.bytes.length);
      write(d); text("\nstream\n"); chunks.push(v.bytes); text("\nendstream");
    } else if (isPdfDictionary(v)) {
      text("<<"); for (const [key, item] of v) { write({ kind: "name", value: key }); text(" "); write(item); text("\n"); } text(">>");
    } else throw new TypeError("Unknown PDF value.");
  };
  write(value); return concat(chunks);
}
function concat(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; } return output;
}

/** Copy-on-write serializer. Parser dictionaries and the caller's source are never mutated. */
export class NativePdfWriter {
  private readonly objects = new Map<number, { ref: PdfRef; value: PdfValue }>();
  private readonly shared = new Map<string, PdfRef>();
  private next: number;
  readonly document: NativePdfDocument;
  constructor(document: NativePdfDocument) {
    this.document = document;
    const { xref } = document.getWriterState();
    this.next = 1;
    for (const number of xref.entries.keys()) this.next = Math.max(this.next, number + 1);
  }
  add(value: PdfValue): PdfRef { const ref = pdfReference(this.next++); this.set(ref, value); return ref; }
  get(ref: PdfRef): PdfValue | undefined { const object = this.objects.get(ref.objectNumber); return object?.ref.generation === ref.generation ? object.value : undefined; }
  intern(key: string, value: PdfValue): PdfRef {
    const existing = this.shared.get(key); if (existing) return existing;
    const ref = this.add(value); this.shared.set(key, ref); return ref;
  }
  set(ref: PdfRef, value: PdfValue): void {
    if (!Number.isSafeInteger(ref.objectNumber) || ref.objectNumber <= 0) throw new RangeError("Invalid PDF object number.");
    this.objects.set(ref.objectNumber, { ref, value }); this.next = Math.max(this.next, ref.objectNumber + 1);
  }
  async save(signal?: AbortSignal, options: NativePdfSaveOptions = {}): Promise<Uint8Array> {
    signal?.throwIfAborted();
    const state = this.document.getWriterState();
    const protection = validatePdfOutputProtection(options.protection);
    const sourceProtection = protection.mode === "preserve" ? (options.encryptionSource ?? (options.rewrite ? this.document : undefined))?.getWriterState().protection : undefined;
    const securityRewrite = protection.mode !== "preserve" || sourceProtection !== undefined || options.rewrite === true;
    const rewrite = securityRewrite || state.xref.repaired || state.xref.startXref === null;
    const trailer: PdfDictionary = new Map();
    for (const d of [...state.xref.trailers].reverse()) for (const [key, value] of d) trailer.set(key, value);
    for (const key of ["Type", "W", "Index", "Length", "Filter", "DecodeParms", "XRefStm", "Prev"]) trailer.delete(key);
    const generated = protection.mode === "password" ? await createPdfPasswordProtection(protection.password, protection.ownerPassword, signal) : undefined;
    const encryptionRef = generated || sourceProtection ? pdfReference(this.next) : undefined;
    const encryptionDictionary = generated?.dictionary ?? sourceProtection?.dictionary;
    if (securityRewrite) {
      trailer.delete("Encrypt"); if (protection.mode !== "preserve") trailer.delete("ID");
      if (encryptionRef) trailer.set("Encrypt", encryptionRef);
      if (generated) trailer.set("ID", generated.fileIds);
      else if (sourceProtection) trailer.set("ID", [
        { kind: "string", hex: true, bytes: sourceProtection.fileId }, { kind: "string", hex: true, bytes: sourceProtection.fileId }
      ]);
    }
    const objects = securityRewrite ? new Map<number, { ref: PdfRef; value: PdfValue }>() : new Map(this.objects);
    if (encryptionRef && encryptionDictionary) objects.set(encryptionRef.objectNumber, { ref: encryptionRef, value: encryptionDictionary });
    if (securityRewrite) {
      // Only the final reachable graph belongs to a new security context.
      // Expanding compressed members eliminates old object streams, orphaned
      // deleted content, prior encryption dictionaries and historical xrefs.
      const pending: PdfRef[] = [];
      const enqueue = (value: PdfValue): void => {
        const stack = [value];
        while (stack.length) {
          const entry = stack.pop()!;
          if (isPdfRef(entry)) pending.push(entry);
          else if (Array.isArray(entry)) for (const child of entry) stack.push(child);
          else if (isPdfStream(entry)) stack.push(entry.dictionary);
          else if (isPdfDictionary(entry)) for (const child of entry.values()) stack.push(child);
        }
      };
      enqueue(trailer);
      while (pending.length) {
        signal?.throwIfAborted();
        const ref = pending.pop()!;
        if (objects.has(ref.objectNumber)) continue;
        const changed = this.objects.get(ref.objectNumber);
        const sourceEntry = state.xref.entries.get(ref.objectNumber);
        if (ref.generation !== (changed?.ref.generation ?? sourceEntry?.generation) || (!changed && sourceEntry?.kind === "free")) continue;
        let value = changed?.ref.generation === ref.generation ? changed.value : await this.document.resolveObject(ref, signal);
        if (isPdfStream(value)) {
          const dictionary = new Map(value.dictionary);
          const resolve = async (value: PdfValue | undefined) => isPdfRef(value)
            ? this.get(value) ?? await this.document.resolveValue(value, signal) : value;
          let filters = await resolve(dictionary.get("Filter"));
          const parameterKey = dictionary.has("DecodeParms") ? "DecodeParms" : "DP";
          let parameters = await resolve(dictionary.get(parameterKey));
          // The parser normally consumes /Crypt during decryption. Identity
          // metadata and plaintext source streams can retain it; it must not
          // select an obsolete crypt filter in the new output context.
          while (isPdfName(Array.isArray(filters) ? filters[0] : filters, "Crypt")) {
            filters = Array.isArray(filters) && filters.length > 1 ? filters.slice(1) : undefined;
            parameters = Array.isArray(parameters) && parameters.length > 1 ? parameters.slice(1) : undefined;
            if (filters === undefined) dictionary.delete("Filter"); else dictionary.set("Filter", filters);
            if (parameters === undefined) dictionary.delete(parameterKey); else dictionary.set(parameterKey, parameters);
          }
          value = { ...value, dictionary };
        }
        objects.set(ref.objectNumber, { ref, value }); enqueue(value);
      }
    } else if (rewrite) for (const [number, entry] of state.xref.entries) {
      signal?.throwIfAborted();
      if (!number || entry.kind === "free" || objects.has(number)) continue;
      const ref = pdfReference(number, entry.generation);
      objects.set(number, { ref, value: await this.document.resolveObject(ref, signal) });
    }
    const version = generated || Number(sourceProtection?.dictionary.get("V")) >= 5 ? "2.0" : securityRewrite ? this.document.info.version : "1.7";
    const chunks = [rewrite ? encoder.encode(`%PDF-${version}\n%\x80\x81\x82\x83\n`) : await state.readSource(signal)];
    chunks.push(encoder.encode("\n")); let offset = chunks.reduce((n, chunk) => n + chunk.length, 0);
    const offsets = new Map<number, { offset: number; generation: number }>();
    let processed = 0;
    for (const [number, object] of [...objects].sort((a, b) => a[0] - b[0])) {
      signal?.throwIfAborted();
      offsets.set(number, { offset, generation: object.ref.generation });
      const value = encryptionRef?.objectNumber === number ? object.value
        : generated ? await generated.encryptObject(object.value, object.ref)
          : sourceProtection ? sourceProtection.encrypt(object.value, object.ref)
            : securityRewrite ? object.value : state.encrypt(object.value, object.ref);
      const chunk = concat([encoder.encode(`${number} ${object.ref.generation} obj\n`), serializePdfValue(value), encoder.encode("\nendobj\n")]);
      chunks.push(chunk); offset += chunk.length;
      if (++processed % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    trailer.set("Size", this.next + (encryptionRef ? 1 : 0));
    if (!rewrite) trailer.set("Prev", state.xref.startXref!);
    let xref = "xref\n0 1\n0000000000 65535 f \n";
    for (const [number, item] of [...offsets].sort((a, b) => a[0] - b[0])) {
      if (item.offset > 9_999_999_999) throw new RangeError("PDF offset exceeds classic xref representation.");
      xref += `${number} 1\n${String(item.offset).padStart(10, "0")} ${String(item.generation).padStart(5, "0")} n \n`;
    }
    chunks.push(encoder.encode(xref + "trailer\n"), serializePdfValue(trailer), encoder.encode(`\nstartxref\n${offset}\n%%EOF\n`));
    signal?.throwIfAborted(); return concat(chunks);
  }
}
