/** Resolve a device-pixel floor, retaining the legacy boolean input aliases. */
export function normalizeMinimumStrokeWidth(value: number | boolean | undefined): number {
  if (value === true) return 1;
  if (value === false || value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError("minimumStrokeWidth must be a finite, non-negative number of device pixels.");
  }
  return Math.max(0, value);
}
