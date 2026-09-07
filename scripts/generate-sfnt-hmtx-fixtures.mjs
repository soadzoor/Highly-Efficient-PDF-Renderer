import { mkdir, writeFile } from "node:fs/promises";

import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const outputDirectory = new URL("./fixtures/sfnt/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });

const baseTables = readTables(buildTinySfnt());
const head = baseTables.get("head").slice();
const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
headView.setUint16(16, headView.getUint16(16, false) | 0x0002, false);
const hhea = baseTables.get("hhea").slice();
new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength).setUint16(34, 2, false);
const longMetrics = baseTables.get("hmtx").subarray(0, 8).slice();

await Promise.all([
  writeFile(
    new URL("hmtx-under-count.ttf", outputDirectory),
    buildSfnt(new Map([
      ...baseTables,
      ["head", head],
      ["hhea", hhea],
      // Glyph 2's trailing LSB is omitted. head.flags bit 1 makes its exact
      // replacement the xMin=50 stored in the glyph header.
      ["hmtx", longMetrics]
    ]))
  ),
  writeFile(
    new URL("hmtx-over-count.ttf", outputDirectory),
    buildSfnt(new Map([
      ...baseTables,
      ["head", head],
      ["hhea", hhea],
      // The required glyph-2 LSB is followed by one unreachable stale entry.
      ["hmtx", concatenate([longMetrics, Uint8Array.of(0, 50, 0x12, 0x34)])]
    ]))
  )
]);

function readTables(sfnt) {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const tableCount = view.getUint16(4, false);
  const tables = new Map();
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    const tag = new TextDecoder("latin1").decode(sfnt.subarray(record, record + 4));
    const offset = view.getUint32(record + 8, false);
    const length = view.getUint32(record + 12, false);
    tables.set(tag, sfnt.subarray(offset, offset + length).slice());
  }
  return tables;
}

function buildSfnt(tables) {
  const records = [...tables]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, bytes]) => ({ tag, bytes, offset: 0 }));
  let byteLength = 12 + records.length * 16;
  for (const record of records) {
    byteLength = align4(byteLength);
    record.offset = byteLength;
    byteLength += record.bytes.length;
  }
  const output = new Uint8Array(byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, records.length, false);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const directoryOffset = 12 + index * 16;
    for (let character = 0; character < 4; character += 1) {
      output[directoryOffset + character] = record.tag.charCodeAt(character);
    }
    view.setUint32(directoryOffset + 8, record.offset, false);
    view.setUint32(directoryOffset + 12, record.bytes.length, false);
    output.set(record.bytes, record.offset);
  }
  return output;
}

function concatenate(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function align4(value) {
  return (value + 3) & ~3;
}
