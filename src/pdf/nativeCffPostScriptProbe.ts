import { throwIfAborted } from "./nativeTypes";

interface IndexBounds {
  readonly count: number;
  readonly offSize: number;
  readonly offsetsStart: number;
  readonly dataStart: number;
  readonly end: number;
}

/** Detect optional font-loading PostScript without eagerly parsing CFF outlines or consuming their limits. */
export function nativeCffUsesPostScript(bytes: Uint8Array, signal?: AbortSignal): boolean {
  throwIfAborted(signal);
  const cff2 = bytes[0] === 2;
  if ((!cff2 && bytes[0] !== 1) || bytes.length < (cff2 ? 5 : 4)) return false;
  const headerSize = bytes[2];
  if (headerSize < (cff2 ? 5 : 4) || headerSize > bytes.length) return false;
  const fdArrays = new Set<number>();
  const uint = (offset: number, size: number): number | undefined => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.length) return undefined;
    let value = 0;
    for (let index = 0; index < size; index += 1) value = value * 256 + bytes[offset + index];
    return value;
  };
  const indexBounds = (offset: number): IndexBounds | undefined => {
    const countSize = cff2 ? 4 : 2;
    const count = uint(offset, countSize);
    if (count === undefined) return undefined;
    if (count === 0) return { count, offSize: 0, offsetsStart: offset + countSize,
      dataStart: offset + countSize, end: offset + countSize };
    const offSize = uint(offset + countSize, 1);
    if (offSize === undefined || offSize < 1 || offSize > 4) return undefined;
    const offsetsStart = offset + countSize + 1;
    const dataStart = offsetsStart + (count + 1) * offSize;
    const last = uint(offsetsStart + count * offSize, offSize);
    if (uint(offsetsStart, offSize) !== 1 || last === undefined || last < 1 || dataStart + last - 1 > bytes.length) return undefined;
    return { count, offSize, offsetsStart, dataStart, end: dataStart + last - 1 };
  };
  const dictUsesPostScript = (start: number, end: number): boolean => {
    let lastNumber: number | undefined;
    for (let offset = start; offset < end;) {
      throwIfAborted(signal);
      const byte = bytes[offset++];
      if (byte >= 32 && byte <= 246) { lastNumber = byte - 139; continue; }
      if (byte >= 247 && byte <= 254) {
        if (offset >= end) return false;
        lastNumber = byte <= 250 ? (byte - 247) * 256 + bytes[offset++] + 108
          : -(byte - 251) * 256 - bytes[offset++] - 108;
        continue;
      }
      if (byte === 28 || byte === 29) {
        const size = byte === 28 ? 2 : 4;
        if (offset + size > end) return false;
        const number = uint(offset, size)!;
        lastNumber = number >= 2 ** (size * 8 - 1) ? number - 2 ** (size * 8) : number;
        offset += size;
        continue;
      }
      if (byte === 30) {
        let ended = false;
        while (offset < end) {
          throwIfAborted(signal);
          const value = bytes[offset++];
          if ((value >> 4) === 15 || (value & 15) === 15) { ended = true; break; }
        }
        if (!ended) return false;
        lastNumber = undefined;
        continue;
      }
      if (byte === 12) {
        if (offset >= end) return false;
        const escaped = bytes[offset++];
        if (escaped === 21) return true; // PostScript SID, including empty/unsupported loading programs.
        if (escaped === 36 && lastNumber !== undefined && lastNumber >= 0) fdArrays.add(lastNumber);
      } else if (byte > 27) return false;
      lastNumber = undefined;
    }
    return false;
  };
  const indexUsesPostScript = (index: IndexBounds): boolean => {
    let previous = 1;
    for (let object = 0; object < index.count; object += 1) {
      throwIfAborted(signal);
      const next = uint(index.offsetsStart + (object + 1) * index.offSize, index.offSize);
      if (next === undefined || next < previous || index.dataStart + next - 1 > index.end) return false;
      if (dictUsesPostScript(index.dataStart + previous - 1, index.dataStart + next - 1)) return true;
      previous = next;
    }
    return false;
  };
  if (cff2) {
    const topLength = uint(3, 2)!;
    if (headerSize + topLength > bytes.length) return false;
    if (dictUsesPostScript(headerSize, headerSize + topLength)) return true;
  } else {
    if (bytes[3] < 1 || bytes[3] > 4) return false;
    const names = indexBounds(headerSize);
    const top = names && indexBounds(names.end);
    if (!top) return false;
    if (indexUsesPostScript(top)) return true;
  }
  for (const offset of fdArrays) {
    const dictionaries = indexBounds(offset);
    if (dictionaries && indexUsesPostScript(dictionaries)) return true;
  }
  // Malformed data is validated by the lazy CFF parser, with its original caller limits.
  return false;
}
