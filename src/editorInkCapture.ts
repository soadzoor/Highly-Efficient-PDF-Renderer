import type { PrimitivePoint } from "./scenePrimitives";

/** Keep coalesced pen samples and the dispatched event's final position. */
export function appendEditorInkSamples(points: [number, number][], event: PointerEvent,
  project: (sample: PointerEvent) => readonly [number, number] | null): void {
  const append = (sample: PointerEvent): void => {
    const point = project(sample); if (!point || !point.every(Number.isFinite)) return;
    const previous = points[points.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push([point[0], point[1]]);
  };
  for (const sample of event.getCoalescedEvents?.() ?? []) append(sample);
  append(event);
}

/** A subpixel fitting budget in document coordinates, independent of camera zoom. */
export function editorInkCaptureTolerance(point: PrimitivePoint,
  project: (point: PrimitivePoint) => PrimitivePoint | null): number {
  const origin = project(point), x = project({ x: point.x + 1, y: point.y }), y = project({ x: point.x, y: point.y + 1 });
  if (!origin || !x || !y) return 0;
  // The Frobenius norm bounds magnification even under a skewed page projection.
  const scale = Math.hypot(x.x - origin.x, x.y - origin.y, y.x - origin.x, y.y - origin.y);
  const tolerance = .35 / scale;
  return Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
}
