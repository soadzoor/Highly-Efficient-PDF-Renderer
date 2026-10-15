/** Binary screen-space coverage for an opaque one-pixel overview stroke span.
 * The caller retains Canvas clipping and paint order when filling the emitted
 * horizontal rectangles. Canonical paths never use this approximation. */
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
    // Resolve pixel-grid ties consistently when a source reverses an edge.
    if (x0 > x1 || (x0 === x1 && y0 > y1)) {
      const swapX = x0, swapY = y0;
      x0 = x1; y0 = y1; x1 = swapX; y1 = swapY;
    }
    const dx = x1 - x0, dy = y1 - y0;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(x0) || !Number.isFinite(y0)) return;
    const width = this.width, height = this.height;
    let from = 0, to = 1;
    // Clip before stepping: offscreen source coordinates may be arbitrarily
    // distant. The half-pixel margin retains widened edge coverage.
    if (x0 < 0 || x1 >= width || y0 < 0 || y0 >= height || y1 < 0 || y1 >= height) {
      if (dx === 0) {
        if (x0 < -.5 || x0 > width + .5) return;
      } else {
        let first = (-.5 - x0) / dx, last = (width + .5 - x0) / dx;
        if (first > last) { const swap = first; first = last; last = swap; }
        from = Math.max(from, first); to = Math.min(to, last);
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
    }
    let x = Math.max(0, Math.min(width - 1, Math.floor(x0 + from * dx)));
    let y = Math.max(0, Math.min(height - 1, Math.floor(y0 + from * dy)));
    const endX = Math.max(0, Math.min(width - 1, Math.floor(x0 + to * dx)));
    const endY = Math.max(0, Math.min(height - 1, Math.floor(y0 + to * dy)));
    const coverage = this.coverage, rowMin = this.rowMin, rowMax = this.rowMax;
    if (y === endY) {
      const row = y * width;
      // The normalized source direction guarantees endX >= x. This also
      // handles the common subpixel segment that maps to just one cell.
      if (x === endX) {
        if (coverage[row + x] !== 0) return;
        coverage[row + x] = 1;
      } else coverage.fill(1, row + x, row + endX + 1);
      if (x < rowMin[y]) rowMin[y] = x;
      if (endX > rowMax[y]) rowMax[y] = endX;
      if (y < this.minY) this.minY = y;
      if (y > this.maxY) this.maxY = y;
      return;
    }
    const firstY = y < endY ? y : endY, lastY = y > endY ? y : endY;
    if (firstY < this.minY) this.minY = firstY;
    if (lastY > this.maxY) this.maxY = lastY;
    const deltaX = Math.abs(endX - x), deltaY = -Math.abs(endY - y);
    const stepX = x < endX ? 1 : -1, stepY = y < endY ? 1 : -1;
    let error = deltaX + deltaY;
    for (;;) {
      const index = y * width + x;
      if (coverage[index] === 0) {
        coverage[index] = 1;
        if (x < rowMin[y]) rowMin[y] = x;
        if (x > rowMax[y]) rowMax[y] = x;
      }
      if (x === endX && y === endY) break;
      const doubled = error * 2;
      if (doubled >= deltaY) { error += deltaY; x += stepX; }
      if (doubled <= deltaX) { error += deltaX; y += stepY; }
    }
  }

  /** Consume the span into the caller's current path without a pixel upload. */
  appendRectangles(context: Pick<CanvasRenderingContext2D, "rect">, signal?: AbortSignal): void {
    for (let y = this.minY; y <= this.maxY; y++) {
      signal?.throwIfAborted();
      const first = this.rowMin[y], last = this.rowMax[y], row = y * this.width;
      for (let x = first; x <= last;) {
        if (this.coverage[row + x] === 0) { x++; continue; }
        const start = x;
        do { this.coverage[row + x++] = 0; } while (x <= last && this.coverage[row + x] !== 0);
        context.rect(start, y, x - start, 1);
      }
      this.rowMin[y] = this.width;
      this.rowMax[y] = -1;
    }
    this.minY = this.height;
    this.maxY = -1;
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
