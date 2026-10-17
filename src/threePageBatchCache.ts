import * as THREE from "three";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { planarViewportFootprintInto } from "./planarProjection";
import type { ThreePageFrame } from "./threePageBatchFrame";
import type { ThreePageTransforms } from "./threePageTransforms";

type Viewport = { width: number; height: number };

export interface ThreePageBatchSource {
  /** The page's own object. Its local matrix places the page in the document. */
  readonly object: THREE.Object3D;
  /** Replaced rather than mutated when the page's content changes. */
  readonly view: { readonly scene: VectorScene; readonly paintBounds: Bounds };
  /** Changes only together with the page's scene, which replaces `view`. */
  readonly dataToLocalMatrix: THREE.Matrix4;
  readonly isDisposed: boolean;
  readonly pageBackgroundAlpha: number;
  /** General plane/frustum culling for a page that is not an XY translation of the document. */
  deriveCullingBounds(camera: THREE.Camera, viewport: Viewport): Bounds | undefined;
}

export interface ThreePageBatchCacheResult {
  frames: readonly ThreePageFrame[];
  changed: boolean;
  /** Pages whose table entry may differ from the frame: every visible page and any that changed. */
  pending: readonly number[];
}

/**
 * Reuse page transforms and intersect a shared, flat document plane only once.
 *
 * A scrolling Reader moves only the camera. Every page is still checked for
 * movement each frame, but from contiguous snapshots and without touching
 * its scene, bounds or matrices unless something changed; only visible pages
 * and pages whose state changed reach the projection pass.
 */
export class ThreePageBatchFrameCache {
  private sources: (ThreePageBatchSource | undefined)[] = [];
  private views: (ThreePageBatchSource["view"] | undefined)[] = [];
  private frames: ThreePageFrame[] = [];
  private cullingBounds: Bounds[] = [];
  private matrices = new Float64Array(0);
  private dataToLocal = new Float64Array(0);
  /** position xyz, quaternion xyzw, scale xyz of auto-updating pages. */
  private poses = new Float64Array(0);
  private poseCurrent = new Uint8Array(0);
  /** Page, paint and coarse text bounds, unioned, in page data units. */
  private boxes = new Float64Array(0);
  private translations = new Float64Array(0);
  private translated = new Uint8Array(0);
  private enabled = new Uint8Array(0);
  private alphas = new Float64Array(0);
  private aaPixels = new Float64Array(0);
  private clipCurrent = new Uint8Array(0);
  private applied = new Uint8Array(0);
  private readonly pending: number[] = [];
  private table?: ThreePageTransforms;
  private boundsRevision = -1;
  private appearanceRevision: number | undefined;
  private origin: number[] = [];
  private projection: number[] = [];
  private camera?: THREE.Camera;
  private coordinateSystem?: THREE.CoordinateSystem;
  private width = NaN;
  private height = NaN;
  private approximate = false;
  private sharedView: { bounds: Bounds; unitsPerPixel: number } | null = null;

  /**
   * `appearanceRevision`, when supplied, changes whenever any page background
   * may have changed; otherwise every page's background is read each update.
   */
  update(pages: readonly ThreePageBatchSource[], table: ThreePageTransforms, documentOrigin: THREE.Matrix4,
    documentToClip: THREE.Matrix4, camera: THREE.Camera, viewport: Viewport, approximate: boolean,
    appearanceRevision?: number): ThreePageBatchCacheResult {
    const count = pages.length;
    const reset = this.table !== table || this.frames.length !== count;
    if (reset) this.allocate(table, count);
    const boundsChanged = this.boundsRevision !== table.boundsRevision;
    this.boundsRevision = table.boundsRevision;
    const appearanceChanged = appearanceRevision === undefined || this.appearanceRevision !== appearanceRevision;
    this.appearanceRevision = appearanceRevision;
    const originChanged = copyChanged(documentOrigin.elements, this.origin);
    const matrixChanged = copyChanged(documentToClip.elements, this.projection);
    const projectionChanged = reset || matrixChanged || this.camera !== camera || this.coordinateSystem !== camera.coordinateSystem ||
      this.width !== viewport.width || this.height !== viewport.height;
    let changed = reset || originChanged || projectionChanged || this.approximate !== approximate;
    this.camera = camera; this.coordinateSystem = camera.coordinateSystem;
    this.width = viewport.width; this.height = viewport.height; this.approximate = approximate;
    if (projectionChanged) this.sharedView = sharedViewport(documentToClip.elements, viewport);
    const sharedView = this.sharedView;
    const pending = this.pending;
    pending.length = 0;
    const matrices = this.matrices, poses = this.poses, boxes = this.boxes, translations = this.translations;
    for (let index = 0; index < count; index++) {
      // Views are replaced, never mutated, so their identity covers scene and bounds.
      const source = pages[index], object = source.object, view = source.view;
      const replacement = this.sources[index] !== source || this.views[index] !== view;
      let frame = this.frames[index];
      const scene = replacement ? view.scene : frame.scene;
      if (replacement) {
        frame = this.frames[index] = { scene, paintBounds: view.paintBounds, dataToDocument: new THREE.Matrix4(),
          dataToClip: new THREE.Matrix4(), visible: false, opaque: false };
        this.sources[index] = source; this.views[index] = view;
        copyInto(source.dataToLocalMatrix.elements, this.dataToLocal, index * 16);
        this.aaPixels[index] = scene.segmentCount || scene.gradientStrokeSegmentCount ? 2 : 0.5;
        this.poseCurrent[index] = 0;
      }
      const boxChanged = (replacement || boundsChanged) && unionBounds(boxes, index * 4, scene.pageBounds, view.paintBounds,
        table.coarseBounds[index]);
      let localChanged = false;
      const pivot = (object as THREE.Object3D & { pivot?: THREE.Vector3 | null }).pivot;
      if (object.matrixAutoUpdate && !pivot) {
        // Three composes auto-updating matrices from their pose. Only a changed
        // pose recomposes, so an unmoved page never touches its matrix.
        const p = object.position, q = object.quaternion, s = object.scale, o = index * 10;
        if (!this.poseCurrent[index] || poses[o] !== p.x || poses[o + 1] !== p.y || poses[o + 2] !== p.z ||
            poses[o + 3] !== q.x || poses[o + 4] !== q.y || poses[o + 5] !== q.z || poses[o + 6] !== q.w ||
            poses[o + 7] !== s.x || poses[o + 8] !== s.y || poses[o + 9] !== s.z) {
          poses[o] = p.x; poses[o + 1] = p.y; poses[o + 2] = p.z;
          poses[o + 3] = q.x; poses[o + 4] = q.y; poses[o + 5] = q.z; poses[o + 6] = q.w;
          poses[o + 7] = s.x; poses[o + 8] = s.y; poses[o + 9] = s.z;
          object.updateMatrix();
          localChanged = copyIntoChanged(object.matrix.elements, matrices, index * 16);
          this.poseCurrent[index] = 1;
        }
      } else {
        if (object.matrixAutoUpdate) object.updateMatrix();
        this.poseCurrent[index] = 0;
        localChanged = copyIntoChanged(object.matrix.elements, matrices, index * 16);
      }
      const transformChanged = replacement || originChanged || localChanged;
      const enabled = object.visible && !source.isDisposed ? 1 : 0;
      let stateChanged = replacement || boxChanged || this.enabled[index] !== enabled;
      this.enabled[index] = enabled;
      if (appearanceChanged || replacement) {
        const alpha = source.pageBackgroundAlpha;
        if (this.alphas[index] !== alpha) { this.alphas[index] = alpha; stateChanged = true; }
        frame.opaque = alpha >= 1;
      }
      if (transformChanged) {
        const m = frame.dataToDocument.copy(documentOrigin);
        multiplyElements(m, matrices, index * 16); multiplyElements(m, this.dataToLocal, index * 16);
        const e = m.elements;
        this.translated[index] = isXYTranslation(e) ? 1 : 0;
        translations[index * 2] = e[12]; translations[index * 2 + 1] = e[13];
      }
      if (transformChanged || projectionChanged) this.clipCurrent[index] = 0;
      if (!transformChanged && !projectionChanged && !stateChanged) {
        if (frame.visible) pending.push(index);
        else if (!this.applied[index]) { pending.push(index); changed = true; }
        continue;
      }
      changed = true;
      if (transformChanged || stateChanged || frame.visible) this.applied[index] = 0;
      frame.visible = frame.enabled = enabled === 1;
      if (frame.visible && sharedView && this.translated[index]) {
        const shared = sharedView.bounds, tx = translations[index * 2], ty = translations[index * 2 + 1];
        const margin = this.aaPixels[index] * sharedView.unitsPerPixel, b = index * 4;
        // Include off-page paint and coarse text, plus conservative screen-space AA.
        const minX = boxes[b] - margin, minY = boxes[b + 1] - margin, maxX = boxes[b + 2] + margin, maxY = boxes[b + 3] + margin;
        if (Number.isFinite(minX + minY + maxX + maxY) &&
            (maxX < shared.minX - tx || minX > shared.maxX - tx || maxY < shared.minY - ty || minY > shared.maxY - ty)) {
          frame.visible = false;
        } else {
          const clip = frame.cullingBounds = this.cullingBounds[index];
          clip.minX = shared.minX - tx; clip.maxX = shared.maxX - tx;
          clip.minY = shared.minY - ty; clip.maxY = shared.maxY - ty;
        }
      } else if (frame.visible) {
        const derived = source.deriveCullingBounds(camera, viewport);
        frame.cullingBounds = derived ? Object.assign(this.cullingBounds[index], derived) : undefined;
      }
      if (frame.visible && !this.clipCurrent[index]) {
        frame.dataToClip.multiplyMatrices(documentToClip, frame.dataToDocument);
        this.clipCurrent[index] = 1;
      }
      if (frame.visible || !this.applied[index]) pending.push(index);
    }
    return { frames: this.frames, changed, pending };
  }

  /** Record that the table now holds every pending page's projection. */
  markApplied(pending: readonly number[]): void {
    for (const index of pending) this.applied[index] = 1;
  }

  private allocate(table: ThreePageTransforms, count: number): void {
    this.table = table;
    this.sources = new Array(count); this.views = new Array(count);
    this.frames = new Array(count);
    this.cullingBounds = Array.from({ length: count }, () => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 }));
    this.matrices = new Float64Array(count * 16); this.dataToLocal = new Float64Array(count * 16);
    this.poses = new Float64Array(count * 10); this.poseCurrent = new Uint8Array(count);
    this.boxes = new Float64Array(count * 4); this.translations = new Float64Array(count * 2);
    this.translated = new Uint8Array(count); this.enabled = new Uint8Array(count);
    this.alphas = new Float64Array(count).fill(NaN); this.aaPixels = new Float64Array(count);
    this.clipCurrent = new Uint8Array(count); this.applied = new Uint8Array(count);
    this.boundsRevision = -1; this.appearanceRevision = undefined;
  }
}

function copyChanged(values: readonly number[], previous: number[]): boolean {
  let changed = values.length !== previous.length;
  for (let index = 0; index < values.length; index++) {
    if (values[index] !== previous[index]) { previous[index] = values[index]; changed = true; }
  }
  return changed;
}

function copyInto(values: readonly number[], target: Float64Array, offset: number): void {
  for (let index = 0; index < 16; index++) target[offset + index] = values[index];
}

function copyIntoChanged(values: readonly number[], target: Float64Array, offset: number): boolean {
  let changed = false;
  for (let index = 0; index < 16; index++) {
    const value = values[index];
    if (target[offset + index] !== value) { target[offset + index] = value; changed = true; }
  }
  return changed;
}

/** Right-multiply by a column-major matrix stored at `offset`. */
function multiplyElements(matrix: THREE.Matrix4, values: Float64Array, offset: number): void {
  const e = matrix.elements;
  const a00 = e[0], a01 = e[4], a02 = e[8], a03 = e[12];
  const a10 = e[1], a11 = e[5], a12 = e[9], a13 = e[13];
  const a20 = e[2], a21 = e[6], a22 = e[10], a23 = e[14];
  const a30 = e[3], a31 = e[7], a32 = e[11], a33 = e[15];
  for (let column = 0; column < 4; column++) {
    const o = offset + column * 4, b0 = values[o], b1 = values[o + 1], b2 = values[o + 2], b3 = values[o + 3];
    e[column * 4] = a00 * b0 + a01 * b1 + a02 * b2 + a03 * b3;
    e[column * 4 + 1] = a10 * b0 + a11 * b1 + a12 * b2 + a13 * b3;
    e[column * 4 + 2] = a20 * b0 + a21 * b1 + a22 * b2 + a23 * b3;
    e[column * 4 + 3] = a30 * b0 + a31 * b1 + a32 * b2 + a33 * b3;
  }
}

function unionBounds(target: Float64Array, offset: number, page: Bounds, paint: Bounds, coarse: Bounds): boolean {
  const minX = Math.min(page.minX, paint.minX, coarse.minX), minY = Math.min(page.minY, paint.minY, coarse.minY);
  const maxX = Math.max(page.maxX, paint.maxX, coarse.maxX), maxY = Math.max(page.maxY, paint.maxY, coarse.maxY);
  const changed = !(target[offset] === minX && target[offset + 1] === minY && target[offset + 2] === maxX && target[offset + 3] === maxY);
  target[offset] = minX; target[offset + 1] = minY; target[offset + 2] = maxX; target[offset + 3] = maxY;
  return changed;
}

function isXYTranslation(m: readonly number[]): boolean {
  for (let index = 0; index < 16; index++) {
    if (index === 12 || index === 13) { if (!Number.isFinite(m[index])) return false; }
    else if (m[index] !== (index % 5 === 0 ? 1 : 0)) return false;
  }
  return true;
}

function sharedViewport(m: readonly number[], viewport: Viewport): { bounds: Bounds; unitsPerPixel: number } | null {
  const bounds = planarViewportFootprintInto(m, viewport,
    { minX: 0, minY: 0, maxX: 0, maxY: 0, maxUnitsPerPixel: 0, unitsPerPixelX: 0, unitsPerPixelY: 0 });
  return bounds ? { bounds, unitsPerPixel: bounds.maxUnitsPerPixel } : null;
}
