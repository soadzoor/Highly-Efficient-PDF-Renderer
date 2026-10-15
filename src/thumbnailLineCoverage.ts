import { THUMBNAIL_STROKE_SUBPIXELS } from "./thumbnailTypes";

const SAMPLE_COUNTS = Uint8Array.of(0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4);

/** Four-sample screen-space coverage for an opaque one-pixel overview span.
 * Each byte keeps the union of four geometric samples, preserving overlaps
 * before the caller paints disjoint pixel runs with their coverage alpha. */
export class ThumbnailLineCoverage {
  private readonly width: number;
  private readonly height: number;
  private readonly coverage: Uint8Array;
  private readonly rowMin: Int32Array;
  private readonly rowMax: Int32Array;
  private minY: number;
  private maxY = -1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.coverage = new Uint8Array(width * height);
    this.rowMin = new Int32Array(height).fill(width);
    this.rowMax = new Int32Array(height).fill(-1);
    this.minY = height;
  }

  appendLine(x0: number, y0: number, x1: number, y1: number): void {
    const grid = THUMBNAIL_STROKE_SUBPIXELS;
    x0 = Math.round(x0 * grid) / grid; y0 = Math.round(y0 * grid) / grid;
    x1 = Math.round(x1 * grid) / grid; y1 = Math.round(y1 * grid) / grid;
    if (x0 > x1 || (x0 === x1 && y0 > y1)) {
      const swapX = x0, swapY = y0;
      x0 = x1; y0 = y1; x1 = swapX; y1 = swapY;
    }
    let dx = x1 - x0, dy = y1 - y0;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(x0) || !Number.isFinite(y0)) return;
    const width = this.width, height = this.height;
    // Clip the centerline before sampling. Points beyond this expanded domain
    // cannot cover an output sample, even with the half-pixel round pen.
    if (x0 < -.5 || x1 > width + .5 || y0 < -.5 || y0 > height + .5 || y1 < -.5 || y1 > height + .5) {
      let from = 0, to = 1;
      if (dx === 0) {
        if (x0 < -.5 || x0 > width + .5) return;
      } else {
        from = Math.max(from, (-.5 - x0) / dx);
        to = Math.min(to, (width + .5 - x0) / dx);
        if (from > to) return;
      }
      if (dy === 0) {
        if (y0 < -.5 || y0 > height + .5) return;
      } else {
        let first = (-.5 - y0) / dy, last = (height + .5 - y0) / dy;
        if (first > last) { const swap = first; first = last; last = swap; }
        from = Math.max(from, first); to = Math.min(to, last);
        if (from > to) return;
      }
      x1 = x0 + to * dx; y1 = y0 + to * dy;
      x0 += from * dx; y0 += from * dy;
      dx = x1 - x0; dy = y1 - y0;
    }
    const minX = Math.max(0, Math.floor(x0 - .5)), maxX = Math.min(width - 1, Math.floor(x1 + .5));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - .5));
    const maxY = Math.min(height - 1, Math.floor(Math.max(y0, y1) + .5));
    if (minX > maxX || minY > maxY) return;
    const lengthSquared = dx * dx + dy * dy;
    if (dy === 0) {
      const first = Math.max(minX, Math.ceil(x0 - .25)), last = Math.min(maxX, Math.floor(x1 - .75));
      for (let y = minY; y <= maxY; y++) {
        const bits = (Math.abs(y + .25 - y0) <= .5 ? 3 : 0) | (Math.abs(y + .75 - y0) <= .5 ? 12 : 0);
        if (bits === 0) continue;
        if (first <= last) this.markRange(y, first, last, bits);
        for (let x = minX; x < first && x <= maxX; x++) this.markPixel(x, y, x0, y0, dx, dy, lengthSquared);
        for (let x = Math.max(first, last + 1); x <= maxX; x++) this.markPixel(x, y, x0, y0, dx, dy, lengthSquared);
      }
      return;
    }
    if (dx === 0) {
      const first = Math.max(minY, Math.ceil(y0 - .25)), last = Math.min(maxY, Math.floor(y1 - .75));
      for (let x = minX; x <= maxX; x++) {
        const bits = (Math.abs(x + .25 - x0) <= .5 ? 5 : 0) | (Math.abs(x + .75 - x0) <= .5 ? 10 : 0);
        if (bits === 0) continue;
        for (let y = first; y <= last; y++) this.markRange(y, x, x, bits);
        for (let y = minY; y < first && y <= maxY; y++) this.markPixel(x, y, x0, y0, dx, dy, lengthSquared);
        for (let y = Math.max(first, last + 1); y <= maxY; y++) this.markPixel(x, y, x0, y0, dx, dy, lengthSquared);
      }
      return;
    }
    if (dx >= Math.abs(dy)) {
      const slope = dy / dx;
      for (let x = minX; x <= maxX; x++) {
        const start = Math.max(x0, x - .25), end = Math.min(x1, x + 1.25);
        if (start > end) continue;
        const a = y0 + (start - x0) * slope, b = y0 + (end - x0) * slope;
        const first = Math.max(minY, Math.floor(Math.min(a, b) - .5));
        const last = Math.min(maxY, Math.floor(Math.max(a, b) + .5));
        for (let y = first; y <= last; y++) this.markPixel(x, y, x0, y0, dx, dy, lengthSquared);
      }
    } else {
      const slope = dx / dy, low = Math.min(y0, y1), high = Math.max(y0, y1);
      for (let y = minY; y <= maxY; y++) {
        const start = Math.max(low, y - .25), end = Math.min(high, y + 1.25);
        if (start > end) continue;
        const a = x0 + (start - y0) * slope, b = x0 + (end - y0) * slope;
        const first = Math.max(minX, Math.floor(Math.min(a, b) - .5));
        const last = Math.min(maxX, Math.floor(Math.max(a, b) + .5));
        for (let x = first; x <= last; x++) this.markPixel(x, y, x0, y0, dx, dy, lengthSquared);
      }
    }
  }

  private markRange(y: number, first: number, last: number, bits: number): void {
    const row = y * this.width, coverage = this.coverage;
    if (bits === 15) coverage.fill(15, row + first, row + last + 1);
    else for (let x = first; x <= last; x++) coverage[row + x] |= bits;
    if (first < this.rowMin[y]) this.rowMin[y] = first;
    if (last > this.rowMax[y]) this.rowMax[y] = last;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  private markPixel(x: number, y: number, x0: number, y0: number, dx: number, dy: number, lengthSquared: number): void {
    const index = y * this.width + x, previous = this.coverage[index];
    if (previous === 15) return;
    const px = x + .25 - x0, py = y + .25 - y0, threshold = .25 * lengthSquared;
    const dot = px * dx + py * dy, cross = px * dy - py * dx;
    let bits = previous;
    if ((bits & 1) === 0 && coveredSample(dot, cross, px, py, dx, dy, lengthSquared, threshold)) bits |= 1;
    if ((bits & 2) === 0 && coveredSample(dot + .5 * dx, cross + .5 * dy, px + .5, py, dx, dy, lengthSquared, threshold)) bits |= 2;
    if ((bits & 4) === 0 && coveredSample(dot + .5 * dy, cross - .5 * dx, px, py + .5, dx, dy, lengthSquared, threshold)) bits |= 4;
    if ((bits & 8) === 0 && coveredSample(dot + .5 * (dx + dy), cross + .5 * (dy - dx), px + .5, py + .5, dx, dy, lengthSquared, threshold)) bits |= 8;
    if (bits !== previous) {
      this.coverage[index] = bits;
      if (previous === 0) this.markRange(y, x, x, bits);
    }
  }

  /** Consume only pixels with this sample count; alpha groups never overlap. */
  appendRectangles(context: Pick<CanvasRenderingContext2D, "rect">, samples = 4, signal?: AbortSignal): boolean {
    let emitted = false, minY = this.height, maxY = -1;
    for (let y = this.minY; y <= this.maxY; y++) {
      signal?.throwIfAborted();
      const first = this.rowMin[y], last = this.rowMax[y], row = y * this.width;
      let remainingFirst = this.width, remainingLast = -1;
      for (let x = first; x <= last;) {
        const bits = this.coverage[row + x];
        if (bits === 0) { x++; continue; }
        if (SAMPLE_COUNTS[bits] !== samples) {
          if (x < remainingFirst) remainingFirst = x;
          remainingLast = x++;
          continue;
        }
        const start = x;
        do { this.coverage[row + x++] = 0; } while (x <= last && SAMPLE_COUNTS[this.coverage[row + x]] === samples);
        context.rect(start, y, x - start, 1);
        emitted = true;
      }
      this.rowMin[y] = remainingFirst;
      this.rowMax[y] = remainingLast;
      if (remainingLast >= 0) { if (y < minY) minY = y; maxY = y; }
    }
    this.minY = minY;
    this.maxY = maxY;
    return emitted;
  }

  clear(): void {
    for (let y = this.minY; y <= this.maxY; y++) {
      const first = this.rowMin[y], last = this.rowMax[y];
      if (first <= last) this.coverage.fill(0, y * this.width + first, y * this.width + last + 1);
      this.rowMin[y] = this.width;
      this.rowMax[y] = -1;
    }
    this.minY = this.height;
    this.maxY = -1;
  }
}

function coveredSample(dot: number, cross: number, px: number, py: number,
  dx: number, dy: number, lengthSquared: number, threshold: number): boolean {
  if (dot <= 0) return px * px + py * py <= .25;
  if (dot >= lengthSquared) { const x = px - dx, y = py - dy; return x * x + y * y <= .25; }
  return cross * cross <= threshold;
}
