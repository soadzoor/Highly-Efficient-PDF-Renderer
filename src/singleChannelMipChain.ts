export interface SingleChannelUint8MipLevel {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Build a deterministic unorm mip chain using a rounded 2x2 box filter.
 *
 * Keeping this on the CPU lets WebGL, WebGPU, and Three upload identical
 * coverage bytes instead of relying on backend-specific mipmap generation.
 */
export function buildSingleChannelUint8MipChain(
  source: Uint8Array,
  width: number,
  height: number
): SingleChannelUint8MipLevel[] {
  const chain: SingleChannelUint8MipLevel[] = [];
  let levelWidth = Math.max(1, Math.trunc(width));
  let levelHeight = Math.max(1, Math.trunc(height));
  let levelData = source;

  chain.push({ width: levelWidth, height: levelHeight, data: levelData });

  while (levelWidth > 1 || levelHeight > 1) {
    const nextWidth = Math.max(1, levelWidth >> 1);
    const nextHeight = Math.max(1, levelHeight >> 1);
    const nextData = new Uint8Array(nextWidth * nextHeight);

    for (let y = 0; y < nextHeight; y += 1) {
      const srcY0 = Math.min(levelHeight - 1, y * 2);
      const srcY1 = Math.min(levelHeight - 1, srcY0 + 1);

      for (let x = 0; x < nextWidth; x += 1) {
        const srcX0 = Math.min(levelWidth - 1, x * 2);
        const srcX1 = Math.min(levelWidth - 1, srcX0 + 1);

        const i00 = srcY0 * levelWidth + srcX0;
        const i01 = srcY0 * levelWidth + srcX1;
        const i10 = srcY1 * levelWidth + srcX0;
        const i11 = srcY1 * levelWidth + srcX1;

        nextData[y * nextWidth + x] =
          ((levelData[i00] + levelData[i01] + levelData[i10] + levelData[i11]) + 2) >> 2;
      }
    }

    chain.push({ width: nextWidth, height: nextHeight, data: nextData });
    levelWidth = nextWidth;
    levelHeight = nextHeight;
    levelData = nextData;
  }

  return chain;
}
