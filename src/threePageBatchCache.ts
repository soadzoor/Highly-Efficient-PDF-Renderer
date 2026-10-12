import * as THREE from "three";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { largestSingularValue2x2 } from "./planarProjection";
import type { ThreePageFrame } from "./threePageBatchFrame";
import type { ThreePageTransforms } from "./threePageTransforms";

type Viewport = { width: number; height: number };

export interface ThreePageBatchSource {
  object: {
    readonly matrix: THREE.Matrix4;
    readonly dataToLocalMatrix: THREE.Matrix4;
    readonly visible: boolean;
    readonly isDisposed: boolean;
    readonly rendererConfig: { pageBackground: readonly number[] };
    deriveViewStateFromThreeCamera(camera: THREE.Camera, viewport: Viewport): { cullingBounds?: Bounds } | null;
  };
  readonly view: { scene: VectorScene; paintBounds: Bounds };
}

interface Entry {
  source: ThreePageBatchSource;
  view: ThreePageBatchSource["view"];
  frame: ThreePageFrame;
  matrix: number[];
  dataToLocal: number[];
  bounds: number[];
  cullingBounds: Bounds;
  visible: boolean;
  disposed: boolean;
  alpha: number;
  aaPixels: number;
  clipCurrent: boolean;
}

/** Reuse page transforms and intersect a shared, flat document plane only once. */
export class ThreePageBatchFrameCache {
  private entries: Entry[] = [];
  private frames: ThreePageFrame[] = [];
  private table?: ThreePageTransforms;
  private origin: number[] = [];
  private projection: number[] = [];
  private camera?: THREE.Camera;
  private coordinateSystem?: THREE.CoordinateSystem;
  private width = NaN;
  private height = NaN;
  private approximate = false;
  private flatView: { bounds: Bounds; unitsPerPixel: number } | null = null;

  update(pages: readonly ThreePageBatchSource[], table: ThreePageTransforms, documentOrigin: THREE.Matrix4,
    documentToClip: THREE.Matrix4, camera: THREE.Camera, viewport: Viewport, approximate: boolean): { frames: readonly ThreePageFrame[]; changed: boolean } {
    const reset = this.table !== table || this.entries.length !== pages.length;
    if (reset) { this.entries = []; this.frames = []; this.table = table; }
    const originChanged = copyChanged(documentOrigin.elements, this.origin);
    const matrixChanged = copyChanged(documentToClip.elements, this.projection);
    const projectionChanged = reset || matrixChanged || this.camera !== camera || this.coordinateSystem !== camera.coordinateSystem ||
      this.width !== viewport.width || this.height !== viewport.height;
    let changed = reset || originChanged || projectionChanged || this.approximate !== approximate;
    this.camera = camera; this.coordinateSystem = camera.coordinateSystem;
    this.width = viewport.width; this.height = viewport.height; this.approximate = approximate;
    if (projectionChanged) this.flatView = flatViewport(documentToClip.elements, viewport);
    for (let index = 0; index < pages.length; index++) {
      const source = pages[index], object = source.object, view = source.view;
      let entry = this.entries[index];
      const replacement = !entry || entry.source !== source || entry.view !== view || entry.frame.scene !== view.scene;
      if (replacement) {
        const frame: ThreePageFrame = { scene: view.scene, paintBounds: view.paintBounds,
          dataToDocument: new THREE.Matrix4(), dataToClip: new THREE.Matrix4(), visible: false, opaque: false };
        entry = this.entries[index] = { source, view, frame, matrix: [], dataToLocal: [], bounds: [],
          cullingBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          visible: false, disposed: false, alpha: NaN, aaPixels: 0, clipCurrent: false };
        this.frames[index] = frame;
      }
      const localChanged = copyChanged(object.matrix.elements, entry.matrix);
      const dataChanged = copyChanged(object.dataToLocalMatrix.elements, entry.dataToLocal);
      const transformChanged = replacement || originChanged || localChanged || dataChanged;
      const frame = entry.frame, coarse = table.coarseBounds[index], page = view.scene.pageBounds, paint = view.paintBounds;
      const boundsChanged = copyBoundsChanged(entry.bounds, page, paint, coarse);
      const alpha = object.rendererConfig.pageBackground[3];
      const aaPixels = view.scene.segmentCount || view.scene.gradientStrokeSegmentCount ? 2 : 0.5;
      const stateChanged = replacement || boundsChanged || entry.visible !== object.visible || entry.disposed !== object.isDisposed ||
        entry.alpha !== alpha || entry.aaPixels !== aaPixels;
      entry.visible = object.visible; entry.disposed = object.isDisposed; entry.alpha = alpha; entry.aaPixels = aaPixels;
      frame.paintBounds = paint; frame.opaque = alpha >= 1;
      if (transformChanged) frame.dataToDocument.copy(documentOrigin).multiply(object.matrix).multiply(object.dataToLocalMatrix);
      if (transformChanged || projectionChanged) entry.clipCurrent = false;
      if (!transformChanged && !projectionChanged && !stateChanged) continue;
      changed = true;
      frame.visible = object.visible && !object.isDisposed;
      if (!frame.visible) continue;
      const translation = frame.dataToDocument.elements;
      if (this.flatView && isXYTranslation(translation)) {
        const shared = this.flatView.bounds;
        const clip = frame.cullingBounds = entry.cullingBounds;
        clip.minX = shared.minX - translation[12]; clip.maxX = shared.maxX - translation[12];
        clip.minY = shared.minY - translation[13]; clip.maxY = shared.maxY - translation[13];
        const margin = aaPixels * this.flatView.unitsPerPixel;
        // Include off-page paint and coarse text, plus conservative screen-space AA.
        const minX = Math.min(page.minX, paint.minX, coarse.minX) - margin;
        const minY = Math.min(page.minY, paint.minY, coarse.minY) - margin;
        const maxX = Math.max(page.maxX, paint.maxX, coarse.maxX) + margin;
        const maxY = Math.max(page.maxY, paint.maxY, coarse.maxY) + margin;
        if (Number.isFinite(minX + minY + maxX + maxY) &&
            (maxX < clip.minX || minX > clip.maxX || maxY < clip.minY || minY > clip.maxY)) {
          frame.visible = false;
          continue;
        }
      } else {
        const derived = object.deriveViewStateFromThreeCamera(camera, viewport)?.cullingBounds;
        frame.cullingBounds = derived ? Object.assign(entry.cullingBounds, derived) : undefined;
      }
      if (!entry.clipCurrent) {
        frame.dataToClip.multiplyMatrices(documentToClip, frame.dataToDocument);
        entry.clipCurrent = true;
      }
    }
    return { frames: this.frames, changed };
  }
}

function copyChanged(values: readonly number[], previous: number[]): boolean {
  let changed = values.length !== previous.length;
  for (let index = 0; index < values.length; index++) {
    if (values[index] !== previous[index]) { previous[index] = values[index]; changed = true; }
  }
  return changed;
}

function copyBoundsChanged(previous: number[], page: Bounds, paint: Bounds, coarse: Bounds): boolean {
  let changed = false;
  for (let index = 0; index < 12; index++) {
    const b = index < 4 ? page : index < 8 ? paint : coarse, component = index % 4;
    const value = component === 0 ? b.minX : component === 1 ? b.minY : component === 2 ? b.maxX : b.maxY;
    if (previous[index] !== value) { previous[index] = value; changed = true; }
  }
  return changed;
}

function isXYTranslation(m: readonly number[]): boolean {
  for (let index = 0; index < 16; index++) {
    if (index === 12 || index === 13) { if (!Number.isFinite(m[index])) return false; }
    else if (m[index] !== (index % 5 === 0 ? 1 : 0)) return false;
  }
  return true;
}

function flatViewport(m: readonly number[], viewport: Viewport): { bounds: Bounds; unitsPerPixel: number } | null {
  const w = m[15], determinant = m[0] * m[5] - m[4] * m[1];
  if (m[3] !== 0 || m[7] !== 0 || !(w > 1e-8) || !Number.isFinite(w) || determinant === 0 || !Number.isFinite(determinant) ||
      !(viewport.width > 0) || !(viewport.height > 0)) return null;
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const cx = x * w - m[12], cy = y * w - m[13];
    const px = (m[5] * cx - m[4] * cy) / determinant, py = (m[0] * cy - m[1] * cx) / determinant;
    bounds.minX = Math.min(bounds.minX, px); bounds.maxX = Math.max(bounds.maxX, px);
    bounds.minY = Math.min(bounds.minY, py); bounds.maxY = Math.max(bounds.maxY, py);
  }
  const sx = viewport.width / (2 * w), sy = viewport.height / (2 * w);
  const maxStretch = largestSingularValue2x2(m[0] * sx, m[4] * sx, m[1] * sy, m[5] * sy);
  const unitsPerPixel = maxStretch / Math.abs(determinant * sx * sy);
  return Number.isFinite(bounds.minX + bounds.minY + bounds.maxX + bounds.maxY + unitsPerPixel) && unitsPerPixel > 0
    ? { bounds, unitsPerPixel } : null;
}
