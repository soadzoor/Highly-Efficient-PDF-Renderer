import { PdfError, throwIfAborted } from "./nativeTypes";

/** Coordinates are already normalized (and avar-mapped), in fvar axis order. */
export interface NativeCffVariationOptions {
  readonly normalizedCoordinates?: readonly number[];
}

/** OpenType CFF2 VariationStore: deltas live in programs, not in this store. */
export class NativeCffVariationStore {
  private readonly scalars: readonly (readonly number[])[];
  private constructor(scalars: readonly (readonly number[])[]) { this.scalars = scalars; }

  static parse(bytes: Uint8Array, offset: number, options: NativeCffVariationOptions, signal?: AbortSignal): NativeCffVariationStore {
    throwIfAborted(signal);
    const range = (at: number, size: number): void => {
      if (!Number.isSafeInteger(at) || !Number.isSafeInteger(size) || at < 0 || size < 0 || at > bytes.length - size) {
        invalid("The CFF2 VariationStore is out of bounds.");
      }
    };
    const u16 = (at: number): number => { range(at, 2); return bytes[at] * 256 + bytes[at + 1]; };
    const u32 = (at: number): number => { range(at, 4); return bytes[at] * 0x1000000 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3]; };
    const length = u16(offset);
    const start = offset + 2;
    // 0xffff is the interoperable extended-length marker used by OpenType
    // compilers for stores larger than 65534 bytes; offsets still require bounds.
    const end = length === 0xffff ? bytes.length : start + length;
    range(start, end - start);
    const storeRange = (at: number, size: number): void => {
      range(at, size);
      if (at < start || at > end - size) invalid("The CFF2 VariationStore offset exceeds its declared length.");
    };
    storeRange(start, 8);
    if (u16(start) !== 1) invalid("The CFF2 ItemVariationStore format is not 1.");
    const regionStart = start + u32(start + 2);
    const count = u16(start + 6);
    storeRange(start + 8, count * 4);
    storeRange(regionStart, 4);
    const axisCount = u16(regionStart), regionCount = u16(regionStart + 2);
    if (regionCount >= 32768) invalid("The CFF2 variation region count has its reserved bit set.");
    storeRange(regionStart + 4, axisCount * regionCount * 6);
    const coordinates = options.normalizedCoordinates ?? Array<number>(axisCount).fill(0);
    if (coordinates.length !== axisCount || coordinates.some(value => !Number.isFinite(value) || value < -1 || value > 1)) {
      invalid("CFF2 variation coordinates must contain one normalized value in [-1,1] per axis.");
    }
    const regionScalars = new Array<number>(regionCount);
    for (let region = 0; region < regionCount; region += 1) {
      throwIfAborted(signal);
      let scalar = 1;
      for (let axis = 0; axis < axisCount; axis += 1) {
        const at = regionStart + 4 + (region * axisCount + axis) * 6;
        const f2dot14 = (position: number): number => { const value = u16(position); return (value >= 32768 ? value - 65536 : value) / 16384; };
        const low = f2dot14(at), peak = f2dot14(at + 2), high = f2dot14(at + 4);
        // OpenType's interpolation algorithm ignores malformed axis regions,
        // and axes with peak 0, rather than discarding the complete outline.
        if (low > peak || peak > high || low < -1 || high > 1 || (low < 0 && high > 0 && peak !== 0) || peak === 0) continue;
        const coordinate = coordinates[axis];
        if (coordinate === peak) continue;
        if (coordinate <= low || coordinate >= high) { scalar = 0; break; }
        scalar *= coordinate < peak ? (coordinate - low) / (peak - low) : (high - coordinate) / (high - peak);
      }
      regionScalars[region] = scalar;
    }
    const scalars = new Array<readonly number[]>(count);
    for (let item = 0; item < count; item += 1) {
      throwIfAborted(signal);
      const relative = u32(start + 8 + item * 4);
      if (relative === 0) { scalars[item] = Object.freeze([]); continue; }
      const at = start + relative;
      storeRange(at, 6);
      if (u16(at) !== 0 || u16(at + 2) !== 0) invalid("CFF2 ItemVariationData must store region indices without delta sets.");
      const regionIndexCount = u16(at + 4);
      storeRange(at + 6, regionIndexCount * 2);
      const selected = new Array<number>(regionIndexCount);
      for (let index = 0; index < regionIndexCount; index += 1) {
        const region = u16(at + 6 + index * 2);
        if (region >= regionCount) invalid("A CFF2 variation region index is out of bounds.");
        selected[index] = regionScalars[region];
      }
      scalars[item] = Object.freeze(selected);
    }
    return new NativeCffVariationStore(Object.freeze(scalars));
  }

  getScalars(index: number): readonly number[] {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.scalars.length) invalid("The CFF2 vsindex references missing ItemVariationData.");
    return this.scalars[index];
  }
}

/** Preserve operands below the blend group; deltas are grouped by value. */
export function blendCffOperands(stack: number[], scalars: readonly number[]): void {
  const count = stack.pop();
  if (count === undefined || !Number.isSafeInteger(count) || count <= 0 || count > stack.length / (scalars.length + 1)) {
    invalid("The CFF blend operator has invalid or truncated operands.");
  }
  const start = stack.length - count * (scalars.length + 1);
  for (let value = 0; value < count; value += 1) {
    let blended = stack[start + value];
    for (let region = 0; region < scalars.length; region += 1) blended += stack[start + count + value * scalars.length + region] * scalars[region];
    if (!Number.isFinite(blended)) invalid("The CFF blend operator produced a non-finite operand.");
    stack[start + value] = blended;
  }
  stack.length = start + count;
}

function invalid(message: string): never {
  throw new PdfError("unsupported-font", message, { details: { reason: "cff-variation-store" } });
}
