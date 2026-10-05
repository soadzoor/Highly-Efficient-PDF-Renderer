/**
 * GPU texture limits belong to the device, not the document. An image larger
 * than one texture is split into tiles that keep its original resolution.
 * Each tile's quad covers an exact part of the image's unit square, so tiles
 * still use the image's own placement matrix and neighbors meet on identical
 * vertices. Only an image with more texels than the device's largest texture
 * could hold is resampled, and that reduction is reported.
 */

/**
 * Overlap between neighboring tiles, in source texels. Linear filtering
 * samples across a seam, and power-of-two aligned tiles keep their mip levels
 * identical to the whole image's for log2(gutter) levels.
 */
const MAX_TILE_GUTTER = 64;
/** Bounds the textures and draws one extreme strip can need. */
const MAX_TILES_PER_AXIS = 16;

export interface RasterTile {
  /** Texel rectangle of the uploaded image held by this tile's texture, overlap included. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Part of the image's unit square covered by this tile's quad: minU, minV, maxU, maxV. */
  readonly quad: readonly [number, number, number, number];
  /** The same corners in this tile's texture coordinates. */
  readonly uv: readonly [number, number, number, number];
}

export interface RasterTilePlan {
  /** Uploaded resolution; below the source's only when it exceeds the device budget. */
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly RasterTile[];
}

export interface RasterTileSource {
  readonly width: number;
  readonly height: number;
  /** Straight-alpha RGBA rows. */
  readonly data: Uint8Array;
}

interface AxisSpan {
  start: number;
  end: number;
  textureStart: number;
  textureEnd: number;
}

const UNIT_RECT = [0, 0, 1, 1] as const;

export function planRasterTiles(sourceWidth: number, sourceHeight: number, maxTextureSize: number): RasterTilePlan {
  const limit = Math.floor(maxTextureSize);
  if (!(limit >= 16) || (sourceWidth <= limit && sourceHeight <= limit)) {
    return {
      width: sourceWidth,
      height: sourceHeight,
      tiles: [{ x: 0, y: 0, width: sourceWidth, height: sourceHeight, quad: UNIT_RECT, uv: UNIT_RECT }]
    };
  }
  let gutter = 1;
  while (gutter * 2 <= Math.min(MAX_TILE_GUTTER, limit / 8)) gutter *= 2;
  const step = Math.floor((limit - 2 * gutter) / gutter) * gutter;

  let width = sourceWidth, height = sourceHeight;
  // Never hold more texels for one image than the device's largest texture.
  const budget = limit * limit;
  if (width * height > budget) {
    const scale = Math.sqrt(budget / (width * height));
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  width = Math.min(width, step * MAX_TILES_PER_AXIS);
  height = Math.min(height, step * MAX_TILES_PER_AXIS);

  const columns = axisSpans(width, limit, step, gutter);
  const rows = axisSpans(height, limit, step, gutter);
  const tiles: RasterTile[] = [];
  for (const row of rows) {
    for (const column of columns) {
      const tileWidth = column.textureEnd - column.textureStart;
      const tileHeight = row.textureEnd - row.textureStart;
      tiles.push({
        x: column.textureStart,
        y: row.textureStart,
        width: tileWidth,
        height: tileHeight,
        quad: [column.start / width, row.start / height, column.end / width, row.end / height],
        uv: [
          (column.start - column.textureStart) / tileWidth,
          (row.start - row.textureStart) / tileHeight,
          (column.end - column.textureStart) / tileWidth,
          (row.end - row.textureStart) / tileHeight
        ]
      });
    }
  }
  return { width, height, tiles };
}

function axisSpans(size: number, limit: number, step: number, gutter: number): AxisSpan[] {
  if (size <= limit) return [{ start: 0, end: size, textureStart: 0, textureEnd: size }];
  const spans: AxisSpan[] = [];
  for (let start = 0; start < size; start += step) {
    const end = Math.min(size, start + step);
    spans.push({ start, end, textureStart: Math.max(0, start - gutter), textureEnd: Math.min(size, end + gutter) });
  }
  return spans;
}

export function sameRasterTilePlan(left: RasterTilePlan, right: RasterTilePlan): boolean {
  return left.width === right.width && left.height === right.height && left.tiles.length === right.tiles.length &&
    left.tiles.every((tile, index) => {
      const other = right.tiles[index];
      return tile.x === other.x && tile.y === other.y && tile.width === other.width && tile.height === other.height;
    });
}

export function isRasterTilePlanDownscaled(source: { width: number; height: number }, plan: RasterTilePlan): boolean {
  return plan.width !== source.width || plan.height !== source.height;
}

/** Premultiplied RGBA for each tile of `plan`, resampled first when the plan is smaller than the source. */
export function rasterTilePixels(source: RasterTileSource, plan: RasterTilePlan): Uint8Array[] {
  const downscaled = isRasterTilePlanDownscaled(source, plan);
  const image = downscaled
    ? resamplePremultiplied(source.data, source.width, source.height, plan.width, plan.height)
    : source.data;
  return plan.tiles.map(tile => {
    if (downscaled && tile.width === plan.width && tile.height === plan.height) return image;
    const out = new Uint8Array(tile.width * tile.height * 4);
    for (let row = 0; row < tile.height; row++) {
      const from = ((tile.y + row) * plan.width + tile.x) * 4;
      const pixels = image.subarray(from, from + tile.width * 4);
      if (downscaled) out.set(pixels, row * tile.width * 4);
      else premultiplyInto(out, row * tile.width * 4, pixels);
    }
    return out;
  });
}

/** Rounds exactly as the renderers' whole-image premultiplication always has. */
function premultiplyInto(target: Uint8Array, offset: number, source: Uint8Array): void {
  for (let i = 0; i + 3 < source.length; i += 4) {
    const alpha = source[i + 3];
    if (alpha <= 0) continue;
    if (alpha >= 255) {
      target[offset + i] = source[i];
      target[offset + i + 1] = source[i + 1];
      target[offset + i + 2] = source[i + 2];
      target[offset + i + 3] = 255;
      continue;
    }
    const scale = alpha / 255;
    target[offset + i] = Math.round(source[i] * scale);
    target[offset + i + 1] = Math.round(source[i + 1] * scale);
    target[offset + i + 2] = Math.round(source[i + 2] * scale);
    target[offset + i + 3] = alpha;
  }
}

/** Area-averages straight-alpha RGBA into a smaller premultiplied image, one output row at a time. */
function resamplePremultiplied(
  data: Uint8Array,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number
): Uint8Array {
  const out = new Uint8Array(outWidth * outHeight * 4);
  const row = new Float64Array(width * 4);
  const scaleX = width / outWidth, scaleY = height / outHeight;
  const area = scaleX * scaleY;
  for (let outY = 0; outY < outHeight; outY++) {
    row.fill(0);
    const top = outY * scaleY, bottom = top + scaleY;
    for (let y = Math.floor(top); y < Math.min(height, Math.ceil(bottom)); y++) {
      const weight = Math.min(bottom, y + 1) - Math.max(top, y);
      if (weight <= 0) continue;
      for (let x = 0, i = y * width * 4; x < width; x++, i += 4) {
        const alpha = data[i + 3] * weight;
        const color = alpha / 255;
        row[x * 4] += data[i] * color;
        row[x * 4 + 1] += data[i + 1] * color;
        row[x * 4 + 2] += data[i + 2] * color;
        row[x * 4 + 3] += alpha;
      }
    }
    for (let outX = 0; outX < outWidth; outX++) {
      const left = outX * scaleX, right = left + scaleX;
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let x = Math.floor(left); x < Math.min(width, Math.ceil(right)); x++) {
        const weight = Math.min(right, x + 1) - Math.max(left, x);
        if (weight <= 0) continue;
        red += row[x * 4] * weight;
        green += row[x * 4 + 1] * weight;
        blue += row[x * 4 + 2] * weight;
        alpha += row[x * 4 + 3] * weight;
      }
      const target = (outY * outWidth + outX) * 4;
      out[target] = Math.min(255, Math.round(red / area));
      out[target + 1] = Math.min(255, Math.round(green / area));
      out[target + 2] = Math.min(255, Math.round(blue / area));
      out[target + 3] = Math.min(255, Math.round(alpha / area));
    }
  }
  return out;
}

const reportedDownscales = new WeakSet<object>();

/** Report, once per image, that it is drawn below its source resolution. */
export function reportRasterTileDownscale(
  index: number,
  source: RasterTileSource,
  plan: RasterTilePlan,
  maxTextureSize: number
): void {
  if (!isRasterTilePlanDownscaled(source, plan) || reportedDownscales.has(source.data)) return;
  reportedDownscales.add(source.data);
  console.warn(
    `[HEPR] Raster image ${index} (${source.width}x${source.height}) needs more GPU memory than this ` +
    `device's ${maxTextureSize}x${maxTextureSize} texture limit allows for one image; drawing it at ` +
    `${plan.width}x${plan.height}.`
  );
}
