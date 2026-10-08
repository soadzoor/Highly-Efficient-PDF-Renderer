import type { MonochromeRaster } from "./monochromeRaster";
import { packedMonochromeCoverageLayout, type PackedMonochromeCoverageAtlas } from "./packedMonochromeCoverage";
import { finishRasterSteps, finishRasterStepsAsync } from "./rasterPreparationYield";

/** Actual decoded JBIG2 ink bitmaps, not OCR characters. Positions are x, y, symbol index. */
export interface MonochromeSymbolScene {
  symbols: { width: number; height: number; data: Uint8Array }[];
  placements: Int32Array;
}

export interface CompactMonochromeAtlas {
  width: number;
  height: number;
  data: Uint8Array;
  uniformBlocks: number;
  reusedBlocks: number;
  symbolBlocks: number;
}

const BLOCK = 32, UNIFORM = 0x80000000, SYMBOLS = 0x40000000;
const MAX_SYMBOLS_PER_BLOCK = 8;
const REVERSE_BITS = Uint8Array.from({ length: 256 }, (_, value) => {
  let reversed = 0;
  for (let bit = 0; bit < 8; bit++) reversed |= ((value >> bit) & 1) << (7 - bit);
  return reversed;
});
const SWAP_NIBBLES = Uint8Array.from({ length: 256 }, (_, value) => ((value & 15) << 4) | (value >> 4));

/** One RGBA texel is a little-endian word. Uniform markers and shared payloads
 * cover every logical level; hardware mipmaps are deliberately disabled.
 * Stop as soon as the index/payload would exceed ordinary packed storage.
 */
export function* compactMonochromeSteps(source: MonochromeRaster, width: number, height: number,
  coverage: PackedMonochromeCoverageAtlas, reduced?: Uint8Array): Generator<void, CompactMonochromeAtlas | undefined> {
  const layout = packedMonochromeCoverageLayout(width, height);
  const baseBits = reduced ? 8 : 1;
  const plainBytes = (reduced ? width * height : Math.ceil(width / 8) * height) + coverage.data.length;
  const levels = [{ width, height, rowBytes: 0, byteOffset: 0 }, ...layout.levels];
  // Bound index overhead before allocating a potentially large scratch buffer.
  const header = 5 + levels.length;
  const mapWords = levels.reduce((sum, level) => sum + Math.ceil(level.width / BLOCK) * Math.ceil(level.height / BLOCK), 0);
  if (mapWords > 500_000 || (header + mapWords) * 4 >= plainBytes * 0.95) return;
  const words = new Uint32Array(Math.floor(plainBytes * 0.95 / 4));
  words.set([width, height, levels.length, BLOCK, baseBits]);
  let end = header + mapWords, mapOffset = header;
  for (let i = 0; i < levels.length; i++) {
    words[5 + i] = mapOffset;
    mapOffset += Math.ceil(levels[i].width / BLOCK) * Math.ceil(levels[i].height / BLOCK);
  }
  const append = (values: ArrayLike<number>): number => {
    if (end + values.length > words.length) throw FULL;
    const offset = end; words.set(values, end); end += values.length; return offset;
  };
  const dictionaries = new Map<string, number[]>();
  // Appending copies the scratch words, so every block can reuse these payloads.
  const basePayload = new Uint32Array(BLOCK * baseBits), coveragePayload = new Uint32Array(BLOCK * 4);
  let uniformBlocks = 0, reusedBlocks = 0, symbolBlocks = 0;
  const storePayload = (payload: Uint32Array, bits: number): number => {
    const first = payload[0] & ((1 << bits) - 1);
    const uniformWord = (first * (bits === 1 ? 0xffffffff : bits === 4 ? 0x11111111 : 0x01010101)) >>> 0;
    let hash = 2166136261, uniform = true;
    for (const value of payload) {
      if (value !== uniformWord) uniform = false;
      hash = Math.imul(hash ^ value, 16777619);
    }
    if (uniform) { uniformBlocks++; return (UNIFORM | first) >>> 0; }
    const key = `${bits}:${hash >>> 0}`, candidates = dictionaries.get(key) ?? [];
    for (const offset of candidates) {
      if (payload.every((value, index) => words[offset + index] === value)) { reusedBlocks++; return offset; }
    }
    // Hash collisions never change pixels or create unbounded comparison chains.
    if (candidates.length >= 32) throw FULL;
    const offset = append(payload); candidates.push(offset); dictionaries.set(key, candidates); return offset;
  };
  let residual = source.data;
  let bins: number[][] | undefined;
  const glyphs = new Map<number, number>();
  const scene = reduced ? undefined : source.symbols;
  if (scene && scene.placements instanceof Int32Array && Array.isArray(scene.symbols) && scene.placements.length % 3 === 0) {
    residual = new Uint8Array(source.data);
    bins = Array.from({ length: Math.ceil(width / BLOCK) * Math.ceil(height / BLOCK) }, () => []);
    const stride = Math.ceil(width / 8), columns = Math.ceil(width / BLOCK);
    let valid = true, work = 0;
    const maximumWork = Math.min(200_000_000, width * height * 8);
    for (let i = 0; i < scene.placements.length && valid; i += 3) {
      const x = scene.placements[i], y = scene.placements[i + 1], symbol = scene.symbols[scene.placements[i + 2]];
      if (!symbol || !Number.isSafeInteger(symbol.width) || !Number.isSafeInteger(symbol.height) ||
          symbol.width < 1 || symbol.height < 1 || symbol.width > 65535 || symbol.height > 65535 ||
          !(symbol.data instanceof Uint8Array) || symbol.data.length < Math.ceil(symbol.width / 8) * symbol.height) { valid = false; break; }
      if (x >= width || y >= height || x + symbol.width <= 0 || y + symbol.height <= 0) continue;
      const rowBytes = Math.ceil(symbol.width / 8);
      for (let sy = Math.max(0, -y); sy < Math.min(symbol.height, height - y); sy++) {
        if ((work += Math.min(symbol.width, width - x) - Math.max(0, -x)) > maximumWork) { valid = false; break; }
        for (let sx = Math.max(0, -x); sx < Math.min(symbol.width, width - x); sx++) {
          if (!(symbol.data[sy * rowBytes + (sx >> 3)] & (128 >> (sx & 7)))) continue;
          const offset = (y + sy) * stride + ((x + sx) >> 3), mask = 128 >> ((x + sx) & 7);
          if (source.data[offset] & mask) { valid = false; break; }
          residual[offset] |= mask;
        }
        yield;
      }
      for (let by = Math.max(0, Math.floor(y / BLOCK)); by < Math.min(Math.ceil(height / BLOCK), Math.ceil((y + symbol.height) / BLOCK)); by++) {
        for (let bx = Math.max(0, Math.floor(x / BLOCK)); bx < Math.min(columns, Math.ceil((x + symbol.width) / BLOCK)); bx++) {
          const bin = bins[by * columns + bx];
          if (bin.length <= MAX_SYMBOLS_PER_BLOCK) bin.push(i);
        }
      }
    }
    if (!valid) { bins = undefined; residual = source.data; }
  }
  try {
    for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
      const level = levels[levelIndex], bits = levelIndex ? 4 : baseBits;
      const columns = Math.ceil(level.width / BLOCK), rows = Math.ceil(level.height / BLOCK);
      for (let by = 0; by < rows; by++) {
        for (let bx = 0; bx < columns; bx++) {
          const blockIndex = by * columns + bx;
          const instances = levelIndex === 0 ? bins?.[blockIndex] : undefined;
          const useSymbols = !!instances?.length && instances.length <= MAX_SYMBOLS_PER_BLOCK;
          const payload = levelIndex ? coveragePayload : basePayload;
          if ((bx + 1) * BLOCK <= level.width && (by + 1) * BLOCK <= level.height) {
            // Full blocks are byte-aligned: turn packed source bytes directly into
            // shader words instead of expanding and repacking 1,024 pixel values.
            if (bits === 1) {
              const data = useSymbols ? residual : source.data, stride = Math.ceil(width / 8);
              let row = by * BLOCK * stride + bx * 4;
              for (let y = 0; y < BLOCK; y++, row += stride) {
                payload[y] = REVERSE_BITS[data[row]] | (REVERSE_BITS[data[row + 1]] << 8) |
                  (REVERSE_BITS[data[row + 2]] << 16) | (REVERSE_BITS[data[row + 3]] << 24);
              }
            } else {
              const data = levelIndex ? coverage.data : reduced!, stride = levelIndex ? level.rowBytes : width;
              const rowBytes = BLOCK * bits / 8;
              let row = (levelIndex ? level.byteOffset : 0) + by * BLOCK * stride + bx * rowBytes, index = 0;
              for (let y = 0; y < BLOCK; y++, row += stride) for (let x = 0; x < rowBytes; x += 4) {
                const offset = row + x;
                payload[index++] = bits === 4
                  ? SWAP_NIBBLES[data[offset]] | (SWAP_NIBBLES[data[offset + 1]] << 8) |
                    (SWAP_NIBBLES[data[offset + 2]] << 16) | (SWAP_NIBBLES[data[offset + 3]] << 24)
                  : data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
              }
            }
          } else {
            // Partial blocks retain the same clamped padding at image edges.
            payload.fill(0);
            for (let y = 0; y < BLOCK; y++) for (let x = 0; x < BLOCK; x++) {
              const px = Math.min(level.width - 1, bx * BLOCK + x), py = Math.min(level.height - 1, by * BLOCK + y);
              let value: number;
              if (!levelIndex) value = reduced ? reduced[py * width + px]
                : ((useSymbols ? residual : source.data)[py * Math.ceil(width / 8) + (px >> 3)] >> (7 - (px & 7))) & 1;
              else {
                const byte = coverage.data[level.byteOffset + py * level.rowBytes + (px >> 1)];
                value = (byte >> ((px & 1) ? 0 : 4)) & 15;
              }
              const bit = (y * BLOCK + x) * bits;
              payload[bit >>> 5] |= value << (bit & 31);
            }
          }
          let entry = storePayload(payload, bits);
          if (useSymbols && scene) {
            const records = [entry, instances!.length];
            for (const placement of instances!) {
              const id = scene.placements[placement + 2], symbol = scene.symbols[id];
              let pointer = glyphs.get(id);
              if (pointer === undefined) {
                const payload = new Uint32Array(2 + Math.ceil(symbol.data.length / 4));
                payload[0] = symbol.width; payload[1] = symbol.height;
                for (let b = 0; b < symbol.data.length; b++) payload[2 + (b >> 2)] |= symbol.data[b] << ((b & 3) * 8);
                pointer = append(payload); glyphs.set(id, pointer);
              }
              records.push(pointer, scene.placements[placement] >>> 0, scene.placements[placement + 1] >>> 0);
            }
            entry = (SYMBOLS | append(records)) >>> 0; symbolBlocks++;
          }
          words[words[5 + levelIndex] + blockIndex] = entry;
          yield;
        }
      }
    }
    const atlasWidth = Math.min(Math.max(width, height), Math.ceil(Math.sqrt(end))), atlasHeight = Math.ceil(end / atlasWidth);
    if (atlasWidth * atlasHeight * 4 >= plainBytes * 0.95) return;
    const data = new Uint8Array(atlasWidth * atlasHeight * 4), view = new DataView(data.buffer);
    for (let i = 0; i < end; i++) {
      view.setUint32(i * 4, words[i], true);
      if ((i & 4095) === 0) yield;
    }
    return { width: atlasWidth, height: atlasHeight, data, uniformBlocks, reusedBlocks, symbolBlocks };
  } catch (error) { if (error !== FULL) throw error; }
}
const FULL = Symbol("compact texture is not smaller");

export function buildCompactMonochromeAtlas(source: MonochromeRaster, width: number, height: number,
  coverage: PackedMonochromeCoverageAtlas, reduced?: Uint8Array): CompactMonochromeAtlas | undefined {
  const blocks = finishRasterSteps(compactMonochromeSteps({ ...source, symbols: undefined }, width, height, coverage, reduced));
  if (!source.symbols || reduced) return blocks;
  const symbols = finishRasterSteps(compactMonochromeSteps(source, width, height, coverage));
  return symbols && (!blocks || symbols.data.length < blocks.data.length) ? symbols : blocks;
}
export async function buildCompactMonochromeAtlasAsync(source: MonochromeRaster, width: number, height: number,
  coverage: PackedMonochromeCoverageAtlas, reduced?: Uint8Array, signal?: AbortSignal): Promise<CompactMonochromeAtlas | undefined> {
  const blocks = await finishRasterStepsAsync(compactMonochromeSteps({ ...source, symbols: undefined }, width, height, coverage, reduced), signal);
  if (!source.symbols || reduced) return blocks;
  const symbols = await finishRasterStepsAsync(compactMonochromeSteps(source, width, height, coverage), signal);
  return symbols && (!blocks || symbols.data.length < blocks.data.length) ? symbols : blocks;
}
