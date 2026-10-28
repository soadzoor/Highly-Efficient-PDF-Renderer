declare module "bidi-js" {
  interface Levels { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] }
  export default function createBidi(): {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl"): Levels;
    getReorderSegments(text: string, levels: Levels, start?: number, end?: number): [number, number][];
  };
}
