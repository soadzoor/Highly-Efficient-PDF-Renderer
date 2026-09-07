/** Exact bounds of nonzero alpha; no thresholding or pixel modification. */
export function findRgbaAlphaBounds(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  signal?: AbortSignal
): { x: number; y: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    signal?.throwIfAborted();
    const rowOffset = y * width * 4 + 3;
    let first = 0;
    while (first < width && rgba[rowOffset + first * 4] === 0) first += 1;
    if (first === width) continue;
    let last = width - 1;
    while (last > first && rgba[rowOffset + last * 4] === 0) last -= 1;
    minX = Math.min(minX, first);
    maxX = Math.max(maxX, last);
    minY = Math.min(minY, y);
    maxY = y;
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
