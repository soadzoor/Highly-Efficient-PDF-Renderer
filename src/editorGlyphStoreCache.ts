import type { VectorScene } from "./pdfVectorExtractor";

const STORE_KEYS = ["textGlyphMetaA", "textGlyphMetaB", "textGlyphSegmentsA", "textGlyphSegmentsB"] as const;
type EditorGlyphStores = Pick<VectorScene, "textGlyphCount" | typeof STORE_KEYS[number]>;

function stores(scene: EditorGlyphStores): EditorGlyphStores {
  return { textGlyphCount: scene.textGlyphCount, textGlyphMetaA: scene.textGlyphMetaA, textGlyphMetaB: scene.textGlyphMetaB,
    textGlyphSegmentsA: scene.textGlyphSegmentsA, textGlyphSegmentsB: scene.textGlyphSegmentsB };
}

/** Glyph resources are immutable; compare their bits without normalizing -0 or NaN. */
function sameStore(first: Float32Array, second: Float32Array): boolean {
  if (first === second) return true;
  if (first.length !== second.length) return false;
  const left = new Uint32Array(first.buffer, first.byteOffset, first.length), right = new Uint32Array(second.buffer, second.byteOffset, second.length);
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

/** Retain one current glyph set, independently of text instances and edit history. */
export function createEditorGlyphStoreCache(initial?: EditorGlyphStores) {
  let current = initial ? stores(initial) : undefined;
  return {
    reuse(scene: EditorGlyphStores): EditorGlyphStores {
      if (!current || current.textGlyphCount !== scene.textGlyphCount || !STORE_KEYS.every(key => sameStore(current![key], scene[key]))) current = stores(scene);
      return current;
    },
    clear(): void { current = undefined; }
  };
}
