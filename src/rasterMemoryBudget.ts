import { isRasterTilePlanDownscaled, planRasterTiles, type RasterTilePlan } from "./rasterTiles";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MIN_RASTER_BUDGET = 16 * MIB;
const MAX_RASTER_BUDGET = 256 * MIB;
const FALLBACK_RASTER_BUDGET = 64 * MIB;

export interface AutomaticRasterMemoryBudget {
  /** Heuristic resident raster target, derived from system RAM rather than measured VRAM. */
  readonly bytes: number;
  /** One additional resident allowance for atomic old/new texture replacement. */
  readonly peakBytes: number;
  readonly deviceMemoryGiB: number | null;
  readonly source: "device-memory" | "fallback";
}

export interface RasterMemorySource {
  readonly width: number;
  readonly height: number;
  /** Presence identifies packed binary data; planning never reads the raster's pixels. */
  readonly monochrome?: unknown;
  /** Additional resident copies, such as canonical textures retained beside a batch atlas. */
  readonly allocationCopies?: number;
}

export interface SceneRasterMemoryPlan {
  /** Index-aligned with the source list, retaining each image's unit-square placement. */
  readonly plans: RasterTilePlan[];
  readonly budget: AutomaticRasterMemoryBudget;
  /** Effective target after internal staging/other resident allocations are reserved. */
  readonly availableBytes: number;
  /** Device-limit tile plans before automatic memory-driven resolution reduction. */
  readonly unscaledBytes: number;
  readonly estimatedBytes: number;
  readonly protectedBytes: number;
  /** Scale relative to the original device-limit plans for unprotected RGBA images. */
  readonly resolutionScale: number;
  /** Packed lossless images or minimum 1x1 textures can exceed the heuristic target. */
  readonly overBudget: boolean;
}

/** No browser globals or memory telemetry are required to select a conservative target. */
export function automaticRasterMemoryBudget(): AutomaticRasterMemoryBudget {
  let deviceMemoryGiB: number | null = null;
  try {
    const value = (globalThis as { navigator?: { deviceMemory?: unknown } }).navigator?.deviceMemory;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) deviceMemoryGiB = value;
  } catch {
    // Embedded hosts can expose navigator or individual properties through throwing getters.
  }
  const bytes = deviceMemoryGiB === null
    ? FALLBACK_RASTER_BUDGET
    : Math.floor(Math.max(MIN_RASTER_BUDGET, Math.min(MAX_RASTER_BUDGET, deviceMemoryGiB * GIB / 32)));
  return { bytes, peakBytes: bytes * 2, deviceMemoryGiB,
    source: deviceMemoryGiB === null ? "fallback" : "device-memory" };
}

/** Logical texture bytes, including every uploaded mip; driver allocation overhead is unknown. */
export function estimateRasterTextureBytes(width: number, height: number, packedMonochrome: boolean): number {
  validateDimensions(width, height);
  let levelWidth = width;
  let levelHeight = height;
  let bytes = packedMonochrome ? Math.ceil(levelWidth / 8) * levelHeight : levelWidth * levelHeight * 4;
  // The packed shader still binds a complete coverage sampler for an image with no reduced mip level.
  if (packedMonochrome && width === 1 && height === 1) return bytes + 1;
  while (levelWidth > 1 || levelHeight > 1) {
    levelWidth = Math.max(1, Math.floor(levelWidth / 2));
    levelHeight = Math.max(1, Math.floor(levelHeight / 2));
    bytes += levelWidth * levelHeight * (packedMonochrome ? 1 : 4);
  }
  return bytes;
}

/** Tile rectangles already include neighboring-image gutters, so overlaps are charged repeatedly. */
export function estimateRasterTilePlanBytes(plan: RasterTilePlan, packedMonochrome: boolean): number {
  return plan.tiles.reduce((bytes, tile) => bytes + estimateRasterTextureBytes(tile.width, tile.height, packedMonochrome), 0);
}

/**
 * Fit aggregate scene demand before GPU allocation. Packed images that fit the
 * device keep their exact dimensions; ordinary RGBA images share a resolution
 * scale. `availableBytes` is an internal reservation, never a required user setting.
 */
export function planSceneRasterMemory(
  sources: readonly RasterMemorySource[],
  maxTextureSize: number,
  availableBytes?: number
): SceneRasterMemoryPlan {
  const budget = automaticRasterMemoryBudget();
  const available = availableBytes === undefined || !Number.isFinite(availableBytes)
    ? budget.bytes
    : Math.max(0, Math.min(budget.bytes, Math.floor(availableBytes)));
  const originalPlans = sources.map(source => {
    validateDimensions(source.width, source.height);
    return planRasterTiles(source.width, source.height, maxTextureSize);
  });
  const packed = sources.map((source, index) => !!source.monochrome && !isRasterTilePlanDownscaled(source, originalPlans[index]));
  const copies = sources.map(source => Number.isFinite(source.allocationCopies) && source.allocationCopies! >= 1
    ? Math.ceil(source.allocationCopies!) : 1);
  const costs = originalPlans.map((plan, index) => estimateRasterTilePlanBytes(plan, packed[index]) * copies[index]);
  const unscaledBytes = costs.reduce((sum, cost) => sum + cost, 0);
  const protectedBytes = costs.reduce((sum, cost, index) => sum + (packed[index] ? cost : 0), 0);
  const result = (plans: RasterTilePlan[], estimatedBytes: number, resolutionScale: number): SceneRasterMemoryPlan =>
    ({ plans, budget, availableBytes: available, unscaledBytes, estimatedBytes, protectedBytes,
      resolutionScale, overBudget: estimatedBytes > available });
  if (unscaledBytes <= available || packed.every(Boolean)) return result(originalPlans, unscaledBytes, 1);

  const atScale = (scale: number): { plans: RasterTilePlan[]; bytes: number } => {
    const plans = originalPlans.map((plan, index) => packed[index] ? plan : planRasterTiles(
      Math.max(1, Math.floor(plan.width * scale)),
      Math.max(1, Math.floor(plan.height * scale)),
      maxTextureSize
    ));
    return { plans, bytes: plans.reduce((sum, plan, index) =>
      sum + (packed[index] ? costs[index] : estimateRasterTilePlanBytes(plan, false) * copies[index]), 0) };
  };
  let low = 0, high = 1;
  let selected = atScale(0);
  if (selected.bytes > available) return result(selected.plans, selected.bytes, 0);
  // Search actual tile/mip bytes, rather than a square-root approximation that misses gutters and strips.
  for (let iteration = 0; iteration < 32; iteration++) {
    const scale = (low + high) / 2;
    const candidate = atScale(scale);
    if (candidate.bytes <= available) {
      low = scale;
      selected = candidate;
    } else high = scale;
  }
  return result(selected.plans, selected.bytes, low);
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 ||
      !Number.isSafeInteger(width * height * 4)) {
    throw new RangeError("Raster memory estimates require positive integer dimensions with a safe byte count.");
  }
}

const reportedPlans = new WeakMap<object, string>();
const reportedUnownedPlans = new Set<string>();

/** Report changes caused by the automatic memory heuristic, separately from device texture limits. */
export function reportRasterMemoryBudget(plan: SceneRasterMemoryPlan, owner?: object): void {
  if (plan.resolutionScale >= 1 && !plan.overBudget) return;
  const key = `${plan.budget.bytes}:${plan.availableBytes}:${plan.unscaledBytes}:${plan.estimatedBytes}:${plan.protectedBytes}`;
  if (owner ? reportedPlans.get(owner) === key : reportedUnownedPlans.has(key)) return;
  if (owner) reportedPlans.set(owner, key);
  else reportedUnownedPlans.add(key);
  const origin = plan.budget.deviceMemoryGiB === null ? "a conservative fallback" :
    `${plan.budget.deviceMemoryGiB} GiB of reported device RAM`;
  console.warn(`[HEPR] Raster GPU demand is estimated at ${Math.ceil(plan.unscaledBytes / MIB)} MiB; ` +
    `the automatic resident raster target is ${Math.ceil(plan.availableBytes / MIB)} MiB, estimated from ${origin}, not measured VRAM. ` +
    (plan.resolutionScale < 1 ? `Drawing RGBA rasters at reduced resolution (${Math.ceil(plan.estimatedBytes / MIB)} MiB estimated). ` : "") +
    (plan.overBudget ? "Keeping lossless packed rasters and minimum textures even though they exceed this heuristic target." : ""));
}
