import { PdfError, throwIfAborted } from "../nativeTypes";

export const JBIG2_MAX_WORK = Number.MAX_SAFE_INTEGER;
const REGION_TYPES = new Set([4, 6, 7, 20, 22, 23, 36, 38, 39, 40, 42, 43]);
const SEGMENT_TYPES = new Set([0, ...REGION_TYPES, 16, 48, 49, 50, 51, 52, 53, 62]);

/** Strip the optional standalone header tolerated by recent PDF.js versions. */
export function stripJbig2FileHeader(bytes: Uint8Array): Uint8Array {
  const signature = [0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return bytes;
  const length = bytes[8] & 2 ? 9 : 13;
  if (bytes.length < length) invalid("Truncated JBIG2 file header.");
  return bytes.subarray(length);
}

/** Validate segment structure and account declared resources before decoding.
 * Smaller caller-selected memory/work allowances remain enforceable; defaults
 * attempt allocation on the host within numeric and Wasm addressing capacity.
 */
export function preflightJbig2(encoded: Uint8Array, globals: Uint8Array, width: number, height: number,
  maxBytes: number, signal?: AbortSignal, maximumWork = JBIG2_MAX_WORK): number {
  let bytes = encoded.length + globals.length + Math.ceil(width / 8) * height;
  let work = 0, symbols = 0, pageSeen = false;
  const dictionaries = new Map<number, number>();
  const patterns = new Map<number, { width: number; height: number; count: number }>();
  const reserve = (count: number): void => {
    if (!Number.isSafeInteger(count) || count < 0 || (bytes += count) > maxBytes) resource("jbig2-working-set");
  };
  const step = (count: number): void => {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(count) || count < 0 || (work += count) > maximumWork) resource("jbig2-work");
  };
  const countSymbols = (count: number): void => {
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(symbols += count)) resource("jbig2-symbols");
    reserve(count * 16); step(count);
  };
  const bitmap = (w: number, h: number): void => { reserve(w * h + h * 16); step(w * h); };
  reserve(0);
  for (const data of [globals, encoded]) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const require = (offset: number, count: number, end = data.length): void => {
      if (!Number.isSafeInteger(offset) || count < 0 || offset + count > end) invalid("Truncated JBIG2 segment.");
    };
    const u32 = (offset: number, end = data.length): number => { require(offset, 4, end); return view.getUint32(offset); };
    let position = 0;
    while (position < data.length) {
      step(1); reserve(128);
      require(position, 6);
      const number = u32(position), flags = data[position + 4], type = flags & 63;
      if (!SEGMENT_TYPES.has(type)) invalid("Invalid JBIG2 segment type.");
      let count = data[position + 5] >>> 5;
      position += 6;
      if (count === 7) {
        count = u32(position - 1) & 0x1fffffff;
        countSymbols(count);
        position += 3;
        const retentionBytes = Math.ceil((count + 1) / 8);
        require(position, retentionBytes); reserve(retentionBytes); position += retentionBytes;
      } else {
        if (count === 5 || count === 6) invalid("Invalid JBIG2 referred-to flags.");
        countSymbols(count);
      }
      const referenceBytes = number <= 256 ? 1 : number <= 65536 ? 2 : 4;
      require(position, count * referenceBytes);
      let imported = 0, pattern: { width: number; height: number; count: number } | undefined;
      for (let index = 0; index < count; index++) {
        const reference = referenceBytes === 1 ? data[position] : referenceBytes === 2 ? view.getUint16(position) : u32(position);
        imported += dictionaries.get(reference) ?? 0;
        pattern ??= patterns.get(reference);
        position += referenceBytes;
      }
      const associationBytes = flags & 64 ? 4 : 1;
      require(position, associationBytes + 4);
      const page = associationBytes === 1 ? data[position] : u32(position);
      position += associationBytes;
      let length = u32(position); position += 4;
      const start = position;
      if (length === 0xffffffff) {
        if (type !== 38) invalid("Invalid unknown JBIG2 segment length.");
        require(start, 18);
        const regionHeight = u32(start + 4), mmr = data[start + 17] & 1;
        let end = start;
        for (; end + 6 <= data.length; end++) {
          if ((end & 255) === 0) step(256);
          if (data[end] === (mmr ? 0 : 255) && data[end + 1] === (mmr ? 0 : 172) && u32(end + 2) === regionHeight) break;
        }
        if (end + 6 > data.length) invalid("JBIG2 segment end was not found.");
        length = end + 6 - start;
      }
      const end = start + length;
      require(start, length);
      let cursor = start;
      if (REGION_TYPES.has(type)) {
        require(start, 17, end); bitmap(u32(start, end), u32(start + 4, end)); cursor += 17;
      }
      if (type === 48) {
        require(start, 19, end);
        if (pageSeen || data === globals || !page || u32(start, end) !== width || u32(start + 4, end) !== height) {
          throw new PdfError("unsupported-image", "JBIG2 page dimensions disagree with the PDF image.", {
            details: { codec: "jbig2", reason: "dimension-mismatch" }
          });
        }
        pageSeen = true; bitmap(width, height);
      } else if (type === 0) {
        require(cursor, 2, end);
        const dictionaryFlags = view.getUint16(cursor); cursor += 2;
        if (!(dictionaryFlags & 1)) cursor += (dictionaryFlags & 0x0c00 ? 1 : 4) * 2;
        if ((dictionaryFlags & 2) && !(dictionaryFlags & 0x1000)) cursor += 4;
        require(cursor, 8, end);
        const exported = u32(cursor, end), added = u32(cursor + 4, end);
        countSymbols(exported + added + imported);
        if (exported > added + imported) invalid("Invalid exported JBIG2 symbol count.");
        dictionaries.set(number, exported);
      } else if (type === 4 || type === 6 || type === 7) {
        require(cursor, 2, end);
        const textFlags = view.getUint16(cursor); cursor += 2;
        if (textFlags & 1) cursor += 2;
        if ((textFlags & 2) && !(textFlags & 0x8000)) cursor += 4;
        countSymbols(u32(cursor, end));
      } else if (type === 16) {
        require(cursor, 7, end);
        const w = data[cursor + 1], h = data[cursor + 2], count = u32(cursor + 3, end) + 1;
        countSymbols(count); bitmap(w * count, h); reserve(count * h * 80);
        patterns.set(number, { width: w, height: h, count });
      } else if (type === 20 || type === 22 || type === 23) {
        require(cursor, 21, end);
        const gridWidth = u32(cursor + 1, end), gridHeight = u32(cursor + 5, end);
        bitmap(gridWidth, gridHeight);
        if (pattern) step(gridWidth * gridHeight * (pattern.width * pattern.height + pattern.height + Math.ceil(Math.log2(pattern.count)) + 1));
      } else if (type === 36 || type === 38 || type === 39) {
        require(cursor, 1, end);
        const genericFlags = data[cursor++];
        if (!(genericFlags & 1)) require(cursor, (genericFlags & 6 ? 1 : 4) * 2, end);
      } else if (type === 40 || type === 42 || type === 43) {
        require(cursor, 1, end);
        if (!(data[cursor] & 1)) require(cursor + 1, 4, end);
      } else if (type === 53) {
        require(start, 9, end);
        // Each table entry can construct at least one tree node. Read the small
        // table syntax so compressed line ranges cannot disguise huge tables.
        const prefixBits = ((data[start] >>> 1) & 7) + 1, rangeBits = ((data[start] >>> 4) & 7) + 1;
        let bit = (start + 9) * 8;
        const bits = (count: number): number => {
          if (bit + count > end * 8) invalid("Truncated JBIG2 Huffman table.");
          let value = 0;
          for (let index = 0; index < count; index++, bit++) value = value * 2 + ((data[bit >>> 3] >>> (7 - (bit & 7))) & 1);
          return value;
        };
        let low = view.getInt32(start + 1), high = view.getInt32(start + 5);
        while (low < high) { bits(prefixBits); const range = bits(rangeBits); reserve(64); step(1); low += 2 ** range; }
        bits(prefixBits); bits(prefixBits); if (data[start] & 1) bits(prefixBits);
      }
      position = end;
      if (type === 51) break;
    }
  }
  if (!pageSeen) invalid("JBIG2 image has no page information.");
  return work;
}

export function jbig2ResourceError(reason: string): PdfError {
  return new PdfError("resource-limit", "JBIG2 decoding exceeds its configured resource budget.", {
    details: { codec: "jbig2", reason }
  });
}
function resource(reason: string): never { throw jbig2ResourceError(reason); }
function invalid(message: string): never { throw new Error(message); }
