import { HEPR_PATH_VERB, type HeprPathStore, type PdfMatrix } from "./heprDocumentData";

const CURVE_ERROR_SQUARED = 0.5 * 0.5;
const LINE_ERROR_SQUARED = 1e-12;

/** Operation-owned preview geometry. Canonical paths remain untouched. */
export class ThumbnailCanvasPath {
  private readonly paths: HeprPathStore;
  private readonly signal: AbortSignal | undefined;
  private context!: CanvasRenderingContext2D;
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;
  private anchorX = 0;
  private anchorY = 0;
  private pendingX = 0;
  private pendingY = 0;
  private pending = false;

  constructor(paths: HeprPathStore, signal?: AbortSignal) {
    this.paths = paths;
    this.signal = signal;
  }

  append(context: CanvasRenderingContext2D, index: number, m: PdfMatrix): void {
    this.context = context;
    this.pending = false;
    const paths = this.paths;
    for (let verb = paths.pathVerbOffsets[index]; verb < paths.pathVerbOffsets[index + 1]; verb++) {
      this.signal?.throwIfAborted();
      const offset = paths.verbCoordinateOffsets[verb], p = paths.coordinates;
      const x = m[0] * p[offset] + m[2] * p[offset + 1] + m[4];
      const y = m[1] * p[offset] + m[3] * p[offset + 1] + m[5];
      switch (paths.verbs[verb]) {
        case HEPR_PATH_VERB.MoveTo:
          this.flush();
          context.moveTo(x, y);
          this.x = this.startX = this.anchorX = x;
          this.y = this.startY = this.anchorY = y;
          break;
        case HEPR_PATH_VERB.LineTo:
          this.line(x, y);
          break;
        case HEPR_PATH_VERB.QuadraticTo: {
          const endX = m[0] * p[offset + 2] + m[2] * p[offset + 3] + m[4];
          const endY = m[1] * p[offset + 2] + m[3] * p[offset + 3] + m[5];
          this.quadratic(this.x, this.y, x, y, endX, endY);
          break;
        }
        case HEPR_PATH_VERB.CubicTo: {
          const controlX = m[0] * p[offset + 2] + m[2] * p[offset + 3] + m[4];
          const controlY = m[1] * p[offset + 2] + m[3] * p[offset + 3] + m[5];
          const endX = m[0] * p[offset + 4] + m[2] * p[offset + 5] + m[4];
          const endY = m[1] * p[offset + 4] + m[3] * p[offset + 5] + m[5];
          this.cubic(this.x, this.y, x, y, controlX, controlY, endX, endY);
          break;
        }
        case HEPR_PATH_VERB.Close:
          this.flush();
          context.closePath();
          this.x = this.anchorX = this.startX;
          this.y = this.anchorY = this.startY;
          break;
      }
    }
    this.flush();
  }

  private flush(): void {
    if (!this.pending) return;
    this.context.lineTo(this.pendingX, this.pendingY);
    this.anchorX = this.pendingX;
    this.anchorY = this.pendingY;
    this.pending = false;
  }

  private line(x: number, y: number): void {
    // Keep turns/backtracking; discard only device-space collinear vertices.
    // No segment-count or subdivision resource cap.
    if (this.pending && (distanceSquared(this.pendingX, this.pendingY, this.anchorX, this.anchorY, x, y) > LINE_ERROR_SQUARED ||
        (this.pendingX - this.anchorX) * (x - this.pendingX) + (this.pendingY - this.anchorY) * (y - this.pendingY) < 0)) {
      this.flush();
    }
    this.pendingX = this.x = x;
    this.pendingY = this.y = y;
    this.pending = true;
  }

  private quadratic(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): void {
    this.signal?.throwIfAborted();
    if (distanceSquared(cx, cy, x0, y0, x1, y1) <= CURVE_ERROR_SQUARED) {
      this.line(x1, y1);
      return;
    }
    const ax = (x0 + cx) / 2, ay = (y0 + cy) / 2;
    const bx = (cx + x1) / 2, by = (cy + y1) / 2;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    this.quadratic(x0, y0, ax, ay, mx, my);
    this.quadratic(mx, my, bx, by, x1, y1);
  }

  private cubic(x0: number, y0: number, ax: number, ay: number, bx: number, by: number, x1: number, y1: number): void {
    this.signal?.throwIfAborted();
    if (distanceSquared(ax, ay, x0, y0, x1, y1) <= CURVE_ERROR_SQUARED &&
        distanceSquared(bx, by, x0, y0, x1, y1) <= CURVE_ERROR_SQUARED) {
      this.line(x1, y1);
      return;
    }
    const p = (x0 + ax) / 2, q = (y0 + ay) / 2;
    const r = (ax + bx) / 2, s = (ay + by) / 2;
    const t = (bx + x1) / 2, u = (by + y1) / 2;
    const v = (p + r) / 2, w = (q + s) / 2;
    const a = (r + t) / 2, b = (s + u) / 2;
    const mx = (v + a) / 2, my = (w + b) / 2;
    this.cubic(x0, y0, p, q, v, w, mx, my);
    this.cubic(mx, my, a, b, t, u, x1, y1);
  }
}

function distanceSquared(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0, length = dx * dx + dy * dy;
  const projection = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length));
  const ex = x - x0 - projection * dx, ey = y - y0 - projection * dy;
  return ex * ex + ey * ey;
}
