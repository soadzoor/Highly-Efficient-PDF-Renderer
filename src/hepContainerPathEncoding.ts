import { align4, transformBytes } from "./hepContainerShared";
import { checkPosition, columns, pathChainMaxLength, readHeader } from "./hepContainerPaths";
import { ByteWriter } from "./parsedDataVarint";

// Writer-only path codec; readers keep only the decoder module.

/** Replace duplicate edge endpoints with exact integer chain corrections. */
export function encodePathChains(bytes: Uint8Array): Uint8Array {
  pathChainMaxLength(bytes.length);
  const header = readHeader(bytes, bytes.length);
  const input = columns(bytes, header.prefixLength, header.lengths);
  const output = Array.from({ length: 4 }, () => new ByteWriter());
  const previous = [0, 0, 0, 0];
  for (let index = 0; index < header.edgeCount; index++) {
    const sx = previous[0] + input[0].signed(), sy = previous[1] + input[1].signed();
    const ex = previous[2] + input[2].signed(), ey = previous[3] + input[3].signed();
    checkPosition(sx); checkPosition(sy); checkPosition(ex); checkPosition(ey);
    output[0].writeZigzagVarint(sx - previous[2]); output[1].writeZigzagVarint(sy - previous[3]);
    output[2].writeZigzagVarint(ex - sx); output[3].writeZigzagVarint(ey - sy);
    previous[0] = sx; previous[1] = sy; previous[2] = ex; previous[3] = ey;
  }
  for (const cursor of input) cursor.expectEnd();
  const writer = new ByteWriter(header.prefixLength + output.reduce((sum, column) => sum + column.length, 0) + 26);
  writer.writeByte(0);
  writer.writeVarUint32(header.prefixLength);
  writer.writeBytes(bytes.subarray(0, header.prefixLength));
  for (const column of output) writer.writeVarUint32(column.length);
  for (const column of output) writer.writeBytes(column.toUint8Array());
  return writer.toUint8Array();
}

/** Unsupported legacy payloads keep their original codec; no geometry is lost. */
export async function chooseHepPathEncoding(
  bytes: Uint8Array,
  originalStoredLength: number,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  signal?.throwIfAborted();
  let encoded: Uint8Array;
  try {
    encoded = encodePathChains(bytes);
  } catch (error) {
    if (error instanceof Error && /path chunk/.test(error.message)) return null;
    throw error;
  }
  signal?.throwIfAborted();
  const compressed = await transformBytes(encoded, true, Number.MAX_SAFE_INTEGER, signal);
  return align4(compressed.length) < align4(originalStoredLength) ? compressed : null;
}
