/**
 * Builds a deterministic three-glyph TrueType font for native PDF fixtures.
 * Codes U+0041 and U+0042 map to the two non-empty glyphs.
 */
export function buildTinySfnt() {
  const head = new Uint8Array(54);
  const headView = new DataView(head.buffer);
  headView.setUint16(18, 1000, false);
  headView.setInt16(50, 1, false);

  const maxp = new Uint8Array(6);
  const maxpView = new DataView(maxp.buffer);
  maxpView.setUint32(0, 0x00010000, false);
  maxpView.setUint16(4, 3, false);

  const hhea = new Uint8Array(36);
  const hheaView = new DataView(hhea.buffer);
  hheaView.setInt16(4, 800, false);
  hheaView.setInt16(6, -200, false);
  hheaView.setUint16(34, 3, false);

  const hmtx = new Uint8Array(12);
  const hmtxView = new DataView(hmtx.buffer);
  hmtxView.setUint16(0, 500, false);
  hmtxView.setUint16(4, 600, false);
  hmtxView.setUint16(8, 700, false);

  const simpleGlyph = new Uint8Array(30);
  const simpleView = new DataView(simpleGlyph.buffer);
  simpleView.setInt16(0, 1, false);
  simpleView.setInt16(2, 0, false);
  simpleView.setInt16(4, 0, false);
  simpleView.setInt16(6, 100, false);
  simpleView.setInt16(8, 100, false);
  simpleView.setUint16(10, 2, false);
  simpleView.setUint16(12, 0, false);
  simpleGlyph.set([1, 1, 1], 14);
  simpleView.setInt16(17, 0, false);
  simpleView.setInt16(19, 100, false);
  simpleView.setInt16(21, -100, false);
  simpleView.setInt16(23, 0, false);
  simpleView.setInt16(25, 0, false);
  simpleView.setInt16(27, 100, false);

  const compoundGlyph = new Uint8Array(18);
  const compoundView = new DataView(compoundGlyph.buffer);
  compoundView.setInt16(0, -1, false);
  compoundView.setInt16(2, 50, false);
  compoundView.setInt16(4, 0, false);
  compoundView.setInt16(6, 150, false);
  compoundView.setInt16(8, 100, false);
  compoundView.setUint16(10, 0x0003, false);
  compoundView.setUint16(12, 1, false);
  compoundView.setInt16(14, 50, false);
  compoundView.setInt16(16, 0, false);

  const glyf = new Uint8Array(simpleGlyph.length + compoundGlyph.length);
  glyf.set(simpleGlyph, 0);
  glyf.set(compoundGlyph, simpleGlyph.length);
  const loca = new Uint8Array(16);
  const locaView = new DataView(loca.buffer);
  locaView.setUint32(0, 0, false);
  locaView.setUint32(4, 0, false);
  locaView.setUint32(8, simpleGlyph.length, false);
  locaView.setUint32(12, glyf.length, false);

  const cmapSubtable = new Uint8Array(32);
  const cmapView = new DataView(cmapSubtable.buffer);
  cmapView.setUint16(0, 4, false);
  cmapView.setUint16(2, cmapSubtable.length, false);
  cmapView.setUint16(6, 4, false);
  cmapView.setUint16(8, 4, false);
  cmapView.setUint16(10, 1, false);
  cmapView.setUint16(14, 66, false);
  cmapView.setUint16(16, 0xffff, false);
  cmapView.setUint16(18, 0, false);
  cmapView.setUint16(20, 65, false);
  cmapView.setUint16(22, 0xffff, false);
  cmapView.setInt16(24, -64, false);
  cmapView.setInt16(26, 1, false);
  cmapView.setUint16(28, 0, false);
  cmapView.setUint16(30, 0, false);
  const cmapTable = new Uint8Array(12 + cmapSubtable.length);
  const cmapTableView = new DataView(cmapTable.buffer);
  cmapTableView.setUint16(0, 0, false);
  cmapTableView.setUint16(2, 1, false);
  cmapTableView.setUint16(4, 3, false);
  cmapTableView.setUint16(6, 1, false);
  cmapTableView.setUint32(8, 12, false);
  cmapTable.set(cmapSubtable, 12);

  const tables = new Map([
    ["cmap", cmapTable],
    ["glyf", glyf],
    ["head", head],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["loca", loca],
    ["maxp", maxp]
  ]);
  const directoryBytes = 12 + tables.size * 16;
  let totalBytes = directoryBytes;
  const records = [];
  for (const [tag, bytes] of tables) {
    totalBytes = (totalBytes + 3) & ~3;
    records.push({ tag, bytes, offset: totalBytes });
    totalBytes += bytes.length;
  }
  const output = new Uint8Array(totalBytes);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, tables.size, false);
  records.forEach((record, index) => {
    const offset = 12 + index * 16;
    for (let char = 0; char < 4; char += 1) output[offset + char] = record.tag.charCodeAt(char);
    view.setUint32(offset + 8, record.offset, false);
    view.setUint32(offset + 12, record.bytes.length, false);
    output.set(record.bytes, record.offset);
  });
  return output;
}
