import * as THREE from "three";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { analyzePlanarBoundsProjectionInto, createPlanarBoundsProjection } from "./planarProjection";
import type { ThreePageTransforms } from "./threePageTransforms";

export interface ThreePageFrame {
  scene: VectorScene;
  paintBounds: Bounds;
  dataToDocument: THREE.Matrix4;
  dataToClip: THREE.Matrix4;
  visible: boolean;
  /** Whether the page is drawn at all when `visible` is already culled by the camera; defaults to `visible`. */
  enabled?: boolean;
  opaque: boolean;
  cullingBounds?: Bounds;
}

interface PageBox {
  x0: number; y0: number; x1: number; y1: number; z0: number; z1: number;
  opaque: boolean;
  /** Paint reaches at most one antialiasing width past the page background. */
  contained: boolean;
  /** Paint plus its antialiasing lies inside the page background. */
  bounded: boolean;
  /** NDC x/y/z of the sheet's four corners, at `corner` in the frame's shared buffer. */
  corners: Float64Array;
  corner: number;
  /**
   * The sheet's NDC depth plane z = z + dx*(x-x0) + dy*(y-y0), null when seen
   * edge-on. Only overlapping sheets need it; see `planeOf`.
   */
  plane?: { x: number; y: number; z: number; dx: number; dy: number } | null;
  /** NDC depth change per pixel, which bounds the background's polygon offset. */
  slope: number;
}

type Viewport = { width: number; height: number };

/**
 * Project actual paint extents, including off-page content, before commuting pages.
 * With `approximateOverlaps`, opaque pages stay batched even where depth cannot
 * order them exactly; the result then reports `approximated`.
 *
 * `pending` limits the pass to the listed pages. It must include every visible
 * page; the table must already hold every other page's state.
 */
export function updateThreePageBatchFrame(table: ThreePageTransforms, pages: readonly ThreePageFrame[], viewport: Viewport, nearDepth = -1,
  approximateOverlaps = false, pending?: readonly number[]) {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const boxes: PageBox[] = [];
  const projection = createPlanarBoundsProjection(), inkProjection = createPlanarBoundsProjection(), point = new THREE.Vector4();
  const count = pending ? pending.length : pages.length;
  const corners = new Float64Array(count * 12);
  let minUnits = Infinity, maxUnits = 0, reason: string | null = null, approximated = false;
  for (let slot = 0; slot < count; slot++) {
    const index = pending ? pending[slot] : slot, page = pages[index];
    if (!page.visible) {
      table.setPage(index, page.dataToDocument, page.dataToClip, false, 1, page.enabled ?? false);
      continue;
    }
    const coarseBounds = table.coarseBounds[index], paint = page.paintBounds;
    const ink = { minX: Math.min(paint.minX, coarseBounds.minX), minY: Math.min(paint.minY, coarseBounds.minY),
      maxX: Math.max(paint.maxX, coarseBounds.maxX), maxY: Math.max(paint.maxY, coarseBounds.maxY) };
    const r = page.scene.pageBounds;
    const b = { minX: Math.min(r.minX, ink.minX), minY: Math.min(r.minY, ink.minY),
      maxX: Math.max(r.maxX, ink.maxX), maxY: Math.max(r.maxY, ink.maxY) };
    analyzePlanarBoundsProjectionInto(b, page.dataToClip.elements, viewport, projection);
    let z0 = Infinity, z1 = -Infinity, behind = 0;
    const corner = slot * 12;
    for (let i = 0; i < 4; i++) {
      // (minX,minY), (minX,maxY), (maxX,minY), (maxX,maxY)
      point.set(i < 2 ? b.minX : b.maxX, i % 2 ? b.maxY : b.minY, 0, 1).applyMatrix4(page.dataToClip);
      if (point.w <= 1e-8) behind++;
      z0 = Math.min(z0,point.z/point.w); z1 = Math.max(z1,point.z/point.w);
      corners[corner+i*3] = point.x/point.w; corners[corner+i*3+1] = point.y/point.w; corners[corner+i*3+2] = point.z/point.w;
    }
    // A rectangle crossing the eye/near plane needs the independent adaptive path.
    if (page.visible && behind !== 4 && (!projection.stable || behind || z0 < nearDepth || !Number.isFinite(z0 + z1))) reason = "unstable-projection";
    const visible = page.visible && behind !== 4 && projection.visible && z1 >= nearDepth && z0 <= 1;
    const fine = 1 / Math.max(1e-8,projection.maxPixelsPerLocalUnit);
    const coarse = 1 / Math.max(1e-8,projection.minPixelsPerLocalUnit);
    table.setPage(index,page.dataToDocument,page.dataToClip,visible,Number.isFinite(coarse) ? coarse : 1,page.enabled ?? true);
    if (!visible) continue;
    minUnits = Math.min(minUnits,fine); maxUnits = Math.max(maxUnits,coarse);
    const clip = page.cullingBounds;
    bounds.minX = Math.min(bounds.minX,clip ? Math.max(b.minX,clip.minX) : b.minX);
    bounds.minY = Math.min(bounds.minY,clip ? Math.max(b.minY,clip.minY) : b.minY);
    bounds.maxX = Math.max(bounds.maxX,clip ? Math.min(b.maxX,clip.maxX) : b.maxX);
    bounds.maxY = Math.max(bounds.maxY,clip ? Math.min(b.maxY,clip.maxY) : b.maxY);
    // Hairline/AA expansion uses the least magnified part of the page. Account
    // for anisotropy in screen space. Overlapping pages rely on their opaque
    // sheets' depth, which isolates exactly the paint (and AA) inside them.
    const aaPixels = page.scene.segmentCount || page.scene.gradientStrokeSegmentCount ? 2 : 0.5;
    const localMargin = aaPixels * coarse, pixels = Math.max(aaPixels, localMargin * projection.maxPixelsPerLocalUnit);
    const hasInk = ink.minX <= ink.maxX && ink.minY <= ink.maxY;
    if (hasInk) analyzePlanarBoundsProjectionInto(ink, page.dataToClip.elements, viewport, inkProjection);
    // Background quads have no outward AA. Expanding the whole sheet would
    // falsely overlap tightly spaced book thumbnails even with wide margins.
    boxes.push({ x0: Math.min(projection.minX, hasInk ? inkProjection.minX-pixels : Infinity),
      y0: Math.min(projection.minY, hasInk ? inkProjection.minY-pixels : Infinity),
      x1: Math.max(projection.maxX, hasInk ? inkProjection.maxX+pixels : -Infinity),
      y1: Math.max(projection.maxY, hasInk ? inkProjection.maxY+pixels : -Infinity),z0,z1,
      opaque: page.opaque,
      contained: ink.minX+aaPixels*fine >= r.minX && ink.minY+aaPixels*fine >= r.minY &&
        ink.maxX-aaPixels*fine <= r.maxX && ink.maxY-aaPixels*fine <= r.maxY,
      bounded: ink.minX-localMargin >= r.minX && ink.minY-localMargin >= r.minY &&
        ink.maxX+localMargin <= r.maxX && ink.maxY+localMargin <= r.maxY,
      corners, corner, slope: Infinity });
  }
  // Sweep where pages are more separated relative to their painted widths.
  // Reader columns share X, so an X sweep would compare every visible pair.
  const sweepY = sweepAlongY(boxes);
  boxes.sort(sweepY ? (a, b) => a.y0 - b.y0 : (a, b) => a.x0 - b.x0);
  const opaque = boxes.every(box => box.opaque);
  // Any earlier reason already rejects the batch; skip the pairwise sweep.
  if (!reason) pairs: for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
    const a=boxes[i],b=boxes[j];
    if (sweepY ? b.y0 > a.y1 : b.x0 > a.x1) break;
    if (sweepY ? a.x1 < b.x0 || b.x1 < a.x0 : a.y1 < b.y0 || b.y1 < a.y0) continue;
    // Translucent overlaps have no depth pass to isolate them.
    if (!a.opaque || !b.opaque) {
      reason ??= "overlapping-page-paints";
      break pairs;
    }
    // Opaque sheets share one depth pass wherever depth tells them apart.
    // Paint is (nearly) inside both sheets, but its antialiasing may reach
    // past one on a thumbnail-sized page. Only that fringe can blend out of
    // page order.
    if (a.contained && b.contained && (depthSeparated(a, b, viewport) || crossingSteeply(a, b, viewport) || !sheetsOverlap(a, b, viewport))) {
      if (!a.bounded || !b.bounded) approximated = true;
    } else if (approximateOverlaps) {
      // Near-coplanar sheets may z-fight and paint outside a sheet may blend
      // out of page order.
      approximated = true;
    } else {
      reason ??= "overlapping-page-paints";
      break pairs;
    }
    // Once approximate, only translucency could still reject a pair.
    if (approximateOverlaps && approximated && opaque) break pairs;
  }
  table.minUnitsPerPixel = Number.isFinite(minUnits) ? Math.max(1e-8,minUnits) : 1;
  table.maxUnitsPerPixel = Number.isFinite(maxUnits) && maxUnits > 0 ? maxUnits : table.minUnitsPerPixel;
  table.opaque = opaque;
  table.finishUpdate();
  if (!boxes.length) Object.assign(bounds,{minX:0,minY:0,maxX:0,maxY:0});
  return { reason, approximated: !reason && approximated, view: { viewState: {cameraCenterX:(bounds.minX+bounds.maxX)/2,cameraCenterY:(bounds.minY+bounds.maxY)/2,zoom:1/table.minUnitsPerPixel},
    nativeViewport: viewport, cullingBounds: bounds } };
}

function sweepAlongY(boxes: readonly PageBox[]): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, width = 0, height = 0;
  for (const box of boxes) {
    minX = Math.min(minX, box.x0); minY = Math.min(minY, box.y0);
    maxX = Math.max(maxX, box.x1); maxY = Math.max(maxY, box.y1);
    width += box.x1 - box.x0; height += box.y1 - box.y0;
  }
  return (maxY - minY) * width > (maxX - minX) * height;
}

function planeOf(box: PageBox, viewport: Viewport): PageBox["plane"] {
  if (box.plane !== undefined) return box.plane;
  // Corners are ordered (minX,minY), (minX,maxY), (maxX,minY), (maxX,maxY).
  const c = box.corners, o = box.corner;
  const ux = c[o+3]-c[o], uy = c[o+4]-c[o+1], uz = c[o+5]-c[o+2], vx = c[o+6]-c[o], vy = c[o+7]-c[o+1], vz = c[o+8]-c[o+2];
  const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
  const plane = { x: c[o], y: c[o+1], z: c[o+2], dx: -nx/nz, dy: -ny/nz };
  box.plane = Math.abs(nz) > 1e-12 * (Math.abs(nx) + Math.abs(ny)) && Number.isFinite(plane.dx) && Number.isFinite(plane.dy) ? plane : null;
  box.slope = box.plane ? Math.max(Math.abs(plane.dx) * 2 / Math.max(1, viewport.width), Math.abs(plane.dy) * 2 / Math.max(1, viewport.height)) : Infinity;
  return box.plane;
}

/**
 * Whether one opaque sheet lies wholly in front of the other's plane, so each
 * shared pixel has an unambiguous nearest background. The rear sheet's paint
 * must clear the front background's polygon offset (one pixel of its depth
 * slope) plus depth precision.
 */
function depthSeparated(a: PageBox, b: PageBox, viewport: Viewport): boolean {
  return a.z1 + 1e-5 < b.z0 || b.z1 + 1e-5 < a.z0 || beyondPlane(a, b, viewport) || beyondPlane(b, a, viewport);
}

function beyondPlane(sheet: PageBox, other: PageBox, viewport: Viewport): boolean {
  const plane = planeOf(sheet, viewport);
  planeOf(other, viewport);
  if (!plane) return false;
  let min = Infinity, max = -Infinity;
  const c = other.corners;
  for (let i = other.corner; i < other.corner + 12; i += 3) {
    // Depth differences over the other sheet are affine, so its corners bound them.
    const delta = c[i+2] - (plane.z + plane.dx*(c[i]-plane.x) + plane.dy*(c[i+1]-plane.y));
    min = Math.min(min, delta); max = Math.max(max, delta);
  }
  return min > sheet.slope + 1e-5 || max < -(other.slope + 1e-5);
}

/**
 * Whether intersecting sheets cross steeply enough that depth leaves them
 * ambiguous only within about a pixel of the crossing line. That band is the
 * backgrounds' polygon offsets (a pixel of slope each) plus depth precision.
 * Independent page rendering depth-tests the same band, so it is no more exact.
 */
function crossingSteeply(a: PageBox, b: PageBox, viewport: Viewport): boolean {
  const planeA = planeOf(a, viewport), planeB = planeOf(b, viewport);
  if (!planeA || !planeB) return false;
  const gradient = Math.hypot((planeB.dx - planeA.dx) * 2 / Math.max(1, viewport.width),
    (planeB.dy - planeA.dy) * 2 / Math.max(1, viewport.height));
  return (a.slope + b.slope + 2e-5) / gradient <= 2;
}

/** Separating-axis test of the projected sheets, in pixels. */
function sheetsOverlap(a: PageBox, b: PageBox, viewport: Viewport): boolean {
  const quadA = screenQuad(a, viewport), quadB = screenQuad(b, viewport);
  for (const quad of [quadA, quadB]) for (let i = 0; i < 8; i += 2) {
    const j = (i + 2) % 8, nx = quad[j+1] - quad[i+1], ny = quad[i] - quad[j];
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      const pa = nx*quadA[k] + ny*quadA[k+1], pb = nx*quadB[k] + ny*quadB[k+1];
      minA = Math.min(minA, pa); maxA = Math.max(maxA, pa); minB = Math.min(minB, pb); maxB = Math.max(maxB, pb);
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

function screenQuad(box: PageBox, viewport: Viewport): Float64Array {
  // Walk the rectangle's corners in perimeter order.
  const quad = new Float64Array(8), c = box.corners;
  [0, 1, 3, 2].forEach((corner, i) => {
    quad[i*2] = c[box.corner+corner*3] * viewport.width / 2; quad[i*2+1] = c[box.corner+corner*3+1] * viewport.height / 2;
  });
  return quad;
}
