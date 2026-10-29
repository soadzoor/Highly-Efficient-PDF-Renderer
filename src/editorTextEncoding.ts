export interface EditorTextCodeGlyph { glyph: number; unicode: string }
export interface EditorTextCode extends EditorTextCodeGlyph { code: number }
export interface EditorTextCodeAllocation {
  partitions: EditorTextCode[][];
  codes: { partition: number; code: number }[];
}

/** Allocate two-byte PDF text codes, sharing repeated glyph/Unicode pairs. */
export function allocateEditorTextCodes(glyphs: readonly EditorTextCodeGlyph[], signal?: AbortSignal): EditorTextCodeAllocation {
  signal?.throwIfAborted();
  // The two-byte format reserves code zero; additional font resources share
  // the same embedded face when the remaining codes have all been allocated.
  const partitions: EditorTextCode[][] = [[]], codes: EditorTextCodeAllocation["codes"] = [];
  const assigned = new Map<string, { partition: number; code: number }>();
  for (const glyph of glyphs) {
    signal?.throwIfAborted();
    const key = `${glyph.glyph}:${glyph.unicode}`;
    let allocation = assigned.get(key);
    if (!allocation) {
      if (partitions[partitions.length - 1].length === 0xffff) partitions.push([]);
      const partition = partitions.length - 1, code = partitions[partition].length + 1;
      partitions[partition].push({ glyph: glyph.glyph, unicode: glyph.unicode, code });
      allocation = { partition, code }; assigned.set(key, allocation);
    }
    codes.push(allocation);
  }
  return { partitions, codes };
}
