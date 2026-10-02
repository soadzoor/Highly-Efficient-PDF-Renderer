export interface FittableRasterSource {
  width: number;
  height: number;
  data: Uint8Array<ArrayBufferLike>;
}

/**
 * Keep an image layer drawable when one of its dimensions exceeds the GPU
 * texture limit (a 9000x1 barcode strip on an 8192 device, for instance).
 * The layer is drawn through its unit-square matrix, so shrinking its pixel
 * grid does not move it: only resolution is lost. RGBA texels are area
 * averaged with alpha weighting, so transparent texels do not darken edges.
 * Returns the source itself when it already fits.
 */
export function fitRasterSourceToTexture<T extends FittableRasterSource>(source: T, maxTextureSize: number): T {
  const limit = Math.max(1, Math.floor(maxTextureSize));
  if (source.width <= limit && source.height <= limit) return source;
  const scale = limit / Math.max(source.width, source.height);
  const width = Math.max(1, Math.min(limit, Math.round(source.width * scale)));
  const height = Math.max(1, Math.min(limit, Math.round(source.height * scale)));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy0 = Math.floor((y * source.height) / height);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * source.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx0 = Math.floor((x * source.width) / width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * source.width) / width));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const offset = (sy * source.width + sx) * 4;
          const a = source.data[offset + 3];
          red += source.data[offset] * a;
          green += source.data[offset + 1] * a;
          blue += source.data[offset + 2] * a;
          alpha += a;
          count += 1;
        }
      }
      const target = (y * width + x) * 4;
      if (alpha > 0) {
        data[target] = Math.round(red / alpha);
        data[target + 1] = Math.round(green / alpha);
        data[target + 2] = Math.round(blue / alpha);
      }
      data[target + 3] = Math.round(alpha / count);
    }
  }
  return { ...source, width, height, data };
}
