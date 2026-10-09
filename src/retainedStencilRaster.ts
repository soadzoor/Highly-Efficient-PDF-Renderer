export interface BinaryStencilPlate {
  readonly coverage: Uint8Array;
  readonly color: readonly [number, number, number, number];
}

export function isBinaryStencil(coverage: Uint8Array, signal: AbortSignal): boolean {
  for (let i = 0; i < coverage.length; i++) {
    if ((i & 65535) === 0) signal.throwIfAborted();
    if (coverage[i] !== 0 && coverage[i] !== 255) return false;
  }
  return true;
}

/**
 * Composite opaque, co-located binary plates before any filtering. Filtering
 * each plate's alpha first makes complementary masks translucent under
 * source-over, even when their original samples cover the tile completely.
 */
export function compositeBinaryStencilPlates(plates: readonly BinaryStencilPlate[], width: number,
  height: number, scale: number, signal: AbortSignal): { data: Uint8Array; width: number; height: number } {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
      !Number.isSafeInteger(width * height * 4) || !Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("Stencil composite dimensions or scale are invalid.");
  }
  const pixels = new Uint8Array(width * height * 4);
  const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
  for (const plate of plates) {
    const red = channel(plate.color[0]), green = channel(plate.color[1]), blue = channel(plate.color[2]);
    for (let y = 0; y < height; y++) {
      signal.throwIfAborted();
      for (let x = 0; x < width; x++) {
        const sample = y * width + x;
        if (plate.coverage[sample] === 0) continue;
        const offset = sample * 4;
        pixels[offset] = red; pixels[offset + 1] = green; pixels[offset + 2] = blue; pixels[offset + 3] = 255;
      }
    }
  }
  const outWidth = Math.max(1, Math.min(width, Math.floor(width * scale)));
  const outHeight = Math.max(1, Math.min(height, Math.floor(height * scale)));
  if (outWidth === width && outHeight === height) return { data: pixels, width, height };
  const output = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    signal.throwIfAborted();
    const top = Math.floor(y * height / outHeight), bottom = Math.floor((y + 1) * height / outHeight);
    for (let x = 0; x < outWidth; x++) {
      const left = Math.floor(x * width / outWidth), right = Math.floor((x + 1) * width / outWidth);
      let red = 0, green = 0, blue = 0, covered = 0;
      for (let row = top; row < bottom; row++) for (let column = left; column < right; column++) {
        const offset = (row * width + column) * 4;
        if (!pixels[offset + 3]) continue;
        red += pixels[offset]; green += pixels[offset + 1]; blue += pixels[offset + 2]; covered++;
      }
      const offset = (y * outWidth + x) * 4;
      if (covered) {
        output[offset] = Math.round(red / covered); output[offset + 1] = Math.round(green / covered);
        output[offset + 2] = Math.round(blue / covered);
        output[offset + 3] = Math.round(255 * covered / ((bottom - top) * (right - left)));
      }
    }
  }
  return { data: output, width: outWidth, height: outHeight };
}
