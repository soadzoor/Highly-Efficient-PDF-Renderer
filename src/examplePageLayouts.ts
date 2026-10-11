import * as THREE from "three";
import { computeReaderPageRects } from "./readerGeometry";
export { READER_PAGE_GAP } from "./readerGeometry";

/**
 * Page arrangements for the Three.js example, after three.js' css3d periodic
 * table demo. "grid" is the loaded document layout.
 */
export type ExamplePageLayout = "reader" | "grid" | "sphere" | "helix";

export interface ExamplePageLayoutPage {
  /** Page center in the loaded layout, in document-local units. */
  gridPosition: THREE.Vector3;
  width: number;
  height: number;
}

export interface ExamplePageLayoutTarget {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

// Spacing ratios of the demo's 118 cards (120x160): a radius-800 sphere, and a
// radius-900 helix advancing 0.175 rad and dropping 8 units per card.
const SPHERE_AREA_PER_PAGE_AREA = (4 * Math.PI * 800 * 800) / (118 * 120 * 160);
const HELIX_ARC_PER_PAGE_WIDTH = (900 * 0.175) / 120;
const HELIX_PITCH_PER_PAGE_HEIGHT = (8 * 2 * Math.PI) / 0.175 / 160;
const HELIX_PAGES_PER_TURN_PER_SQRT_PAGE = (2 * Math.PI) / 0.175 / Math.sqrt(118);
const HELIX_MIN_PAGES_PER_TURN = 8;
const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Target transforms in document-local space, one per page. Pages face outward. */
export function computeExamplePageLayout(
  layout: ExamplePageLayout,
  pages: readonly ExamplePageLayoutPage[]
): ExamplePageLayoutTarget[] {
  if (layout === "reader") {
    const rects = computeReaderPageRects(pages);
    return pages.map((_, index) => ({
      position: new THREE.Vector3(0, (rects[index * 4 + 1] + rects[index * 4 + 3]) / 2, 0),
      quaternion: new THREE.Quaternion()
    }));
  }
  if (layout === "sphere") return computeSphereLayout(pages);
  if (layout === "helix") return computeHelixLayout(pages);
  return pages.map(page => ({ position: page.gridPosition.clone(), quaternion: new THREE.Quaternion() }));
}

function computeSphereLayout(pages: readonly ExamplePageLayoutPage[]): ExamplePageLayoutTarget[] {
  const count = pages.length;
  let area = 0;
  let halfDiagonal = 0;
  for (const page of pages) {
    area += page.width * page.height;
    halfDiagonal = Math.max(halfDiagonal, Math.hypot(page.width, page.height) / 2);
  }
  // Keep the demo's coverage; a few pages still need room not to intersect.
  const radius = Math.max(Math.sqrt((area * SPHERE_AREA_PER_PAGE_AREA) / (4 * Math.PI)), halfDiagonal);
  const turns = Math.sqrt(count * Math.PI);
  return pages.map((_, index) => {
    // The first page is at the top. Half a step keeps pages off the poles,
    // where facing outward along the up axis has no defined roll.
    const phi = Math.acos(1 - (2 * (index + 0.5)) / count);
    const position = new THREE.Vector3().setFromSphericalCoords(radius, phi, turns * phi);
    return { position, quaternion: facing(position) };
  });
}

function computeHelixLayout(pages: readonly ExamplePageLayoutPage[]): ExamplePageLayoutTarget[] {
  const count = pages.length;
  let meanWidth = 0;
  let maxHeight = 0;
  for (const page of pages) {
    meanWidth += page.width / count;
    maxHeight = Math.max(maxHeight, page.height);
  }
  const pagesPerTurn = Math.max(HELIX_MIN_PAGES_PER_TURN, HELIX_PAGES_PER_TURN_PER_SQRT_PAGE * Math.sqrt(count));
  const radius = (pagesPerTurn * HELIX_ARC_PER_PAGE_WIDTH * meanWidth) / (2 * Math.PI);
  // Turns clear the tallest page, so a large sheet never overlaps the next turn.
  const pitch = HELIX_PITCH_PER_PAGE_HEIGHT * maxHeight;
  // Neighbours are spaced by their own widths, so mixed page sizes keep even gaps.
  const angles = [0];
  for (let index = 1; index < count; index++) {
    const arc = (HELIX_ARC_PER_PAGE_WIDTH * (pages[index - 1].width + pages[index].width)) / 2;
    angles.push(angles[index - 1] + arc / radius);
  }
  const middle = angles[count - 1] / 2;
  return angles.map(theta => {
    // The first page starts at the top, facing +Z, and the helix winds to the right.
    const y = (pitch * (middle - theta)) / (2 * Math.PI);
    const position = new THREE.Vector3().setFromCylindricalCoords(radius, theta, y);
    return { position, quaternion: facing(new THREE.Vector3(position.x, 0, position.z)) };
  });
}

/** Orient a page's front (+Z) along `direction`, like Object3D.lookAt for non-cameras. */
function facing(direction: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(direction, ORIGIN, UP));
}

/** Place pages immediately. */
export function applyExamplePageLayout(pages: readonly THREE.Object3D[], targets: readonly ExamplePageLayoutTarget[]): void {
  pages.forEach((page, index) => {
    page.position.copy(targets[index].position);
    page.quaternion.copy(targets[index].quaternion);
  });
}

/** Transforms `amount` of the way from one arrangement to another. */
export function interpolateExamplePageLayout(
  from: readonly ExamplePageLayoutTarget[],
  to: readonly ExamplePageLayoutTarget[],
  amount: number
): ExamplePageLayoutTarget[] {
  return from.map((start, index) => ({
    position: start.position.clone().lerp(to[index].position, amount),
    quaternion: start.quaternion.clone().slerp(to[index].quaternion, amount)
  }));
}

/** Exponential ease-out: fast departure, long settle. */
export function easeOutExpo(amount: number): number {
  return amount >= 1 ? 1 : 1 - Math.pow(2, -10 * amount);
}

interface PageTween {
  page: THREE.Object3D;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromQuaternion: THREE.Quaternion;
  toQuaternion: THREE.Quaternion;
  positionMs: number;
  rotationMs: number;
}

/** Per-page tweens stepped from the host's render loop. */
export class ExamplePageLayoutAnimator {
  private tweens: PageTween[] = [];
  private startTime: number | null = null;

  /**
   * Start from each page's current transform, so a new layout can interrupt a
   * running transition. As in the demo, each page's position and rotation take
   * a random time between one and two durations. The clock starts on the first
   * update, so a slow frame before it does not skip part of the transition.
   */
  animate(
    pages: readonly THREE.Object3D[],
    targets: readonly ExamplePageLayoutTarget[],
    durationMs: number,
    random: () => number = Math.random
  ): void {
    this.startTime = null;
    this.tweens = pages.map((page, index) => ({
      page,
      fromPosition: page.position.clone(),
      toPosition: targets[index].position.clone(),
      fromQuaternion: page.quaternion.clone(),
      toQuaternion: targets[index].quaternion.clone(),
      positionMs: durationMs * (1 + random()),
      rotationMs: durationMs * (1 + random())
    }));
  }

  cancel(): void {
    this.tweens = [];
  }

  /** Move pages to their state at `now`. Returns whether another frame is needed. */
  update(now: number): boolean {
    if (this.tweens.length === 0) return false;
    this.startTime ??= now;
    const elapsed = Math.max(0, now - this.startTime);
    let running = false;
    for (const tween of this.tweens) {
      const position = Math.min(1, elapsed / tween.positionMs);
      const rotation = Math.min(1, elapsed / tween.rotationMs);
      // Finished channels copy their target: lerp can round away from it, and
      // returning to the grid should restore the loaded layout exactly.
      if (position < 1) tween.page.position.lerpVectors(tween.fromPosition, tween.toPosition, easeOutExpo(position));
      else tween.page.position.copy(tween.toPosition);
      if (rotation < 1) tween.page.quaternion.slerpQuaternions(tween.fromQuaternion, tween.toQuaternion, easeOutExpo(rotation));
      else tween.page.quaternion.copy(tween.toQuaternion);
      running ||= position < 1 || rotation < 1;
    }
    if (!running) this.tweens = [];
    return running;
  }
}
