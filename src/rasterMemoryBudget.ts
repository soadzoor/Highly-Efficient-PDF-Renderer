import { isRasterTilePlanDownscaled, planRasterTiles, type RasterTilePlan } from "./rasterTiles";
import { estimateCompressedRasterBytes, type RasterCompressionFormat } from "./rasterCompression";
import { packedMonochromeCoverageLayout } from "./packedMonochromeCoverage";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MIN_RASTER_BUDGET = 16 * MIB;
const MAX_RASTER_BUDGET = 256 * MIB;
const FALLBACK_RASTER_BUDGET = 64 * MIB;
const learnedMonochromeBytes = new WeakMap<object, Map<string, number>>();

/** Preparation/upload reveals content savings without reading pixels during frame planning. */
export function rememberMonochromePlanBytes(source: RasterMemorySource, plan: RasterTilePlan, bytes: number): void {
  const key = (source.monochrome as { data?: unknown } | undefined)?.data;
  if (!key || typeof key !== "object" || !Number.isSafeInteger(bytes) || bytes <= 0) return;
  const costs = learnedMonochromeBytes.get(key) ?? new Map<string, number>();
  const signature = monochromePlanSignature(source, plan);
  if (!costs.has(signature) && costs.size >= 8) costs.delete(costs.keys().next().value!);
  costs.set(signature, bytes); learnedMonochromeBytes.set(key, costs);
}

function monochromePlanSignature(source: RasterMemorySource, plan: RasterTilePlan): string {
  return `${source.width}:${source.height}:${plan.width}:${plan.height}:` +
    plan.tiles.map(tile => `${tile.x},${tile.y},${tile.width},${tile.height}`).join(";");
}

function plannedSourceBytes(source: RasterMemorySource, plan: RasterTilePlan, format?: RasterCompressionFormat | null): number {
  const upperBound = estimateRasterSourcePlanBytes(source, plan, format);
  const key = (source.monochrome as { data?: unknown } | undefined)?.data;
  if (!key || typeof key !== "object" || (!source.reducedMonochrome && isRasterTilePlanDownscaled(source, plan))) return upperBound;
  const learned = learnedMonochromeBytes.get(key)?.get(monochromePlanSignature(source, plan));
  return learned === undefined ? upperBound : Math.min(upperBound, learned);
}

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
  /** Screen-dependent upper bound; canonical source dimensions remain unchanged. */
  readonly displayWidth?: number;
  readonly displayHeight?: number;
  /** Native packed sources use averaged R8 coverage when their display tier is smaller. */
  readonly reducedMonochrome?: boolean;
  /** Presence identifies packed binary data; planning never reads the raster's pixels. */
  readonly monochrome?: unknown;
  /** Content assessment opts an ordinary opaque image into optional GPU compression. */
  readonly compressionEligible?: boolean;
  /** Additional resident copies, such as canonical textures retained beside a batch atlas. */
  readonly allocationCopies?: number;
}

export interface SceneRasterMemoryPlan {
  /** Index-aligned with the source list, retaining each image's unit-square placement. */
  readonly plans: RasterTilePlan[];
  /** Selected only when ordinary RGBA demand exceeds the effective resident target. */
  readonly compressionFormats: (RasterCompressionFormat | null)[];
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
export function estimateRasterTextureBytes(
  width: number, height: number, packedMonochrome: boolean, compressionFormat?: RasterCompressionFormat | null,
  singleChannel = false
): number {
  validateDimensions(width, height);
  if (!packedMonochrome && compressionFormat) return estimateCompressedRasterBytes(width, height, compressionFormat);
  if (packedMonochrome || singleChannel) {
    const atlas = packedMonochromeCoverageLayout(width, height);
    return (packedMonochrome ? Math.ceil(width / 8) * height : width * height) + atlas.width * atlas.height;
  }
  let levelWidth = width;
  let levelHeight = height;
  const channels = 4;
  let bytes = levelWidth * levelHeight * channels;
  while (levelWidth > 1 || levelHeight > 1) {
    levelWidth = Math.max(1, Math.floor(levelWidth / 2));
    levelHeight = Math.max(1, Math.floor(levelHeight / 2));
    bytes += levelWidth * levelHeight * channels;
  }
  return bytes;
}

/** Tile rectangles already include neighboring-image gutters, so overlaps are charged repeatedly. */
export function estimateRasterTilePlanBytes(
  plan: RasterTilePlan, packedMonochrome: boolean, compressionFormat?: RasterCompressionFormat | null,
  singleChannel = false
): number {
  return plan.tiles.reduce((bytes, tile) =>
    bytes + estimateRasterTextureBytes(tile.width, tile.height, packedMonochrome, compressionFormat, singleChannel), 0);
}

/** Charge the representation actually uploaded at this display resolution. */
export function estimateRasterSourcePlanBytes(source: RasterMemorySource, plan: RasterTilePlan,
  format?: RasterCompressionFormat | null): number {
  const packed = !!source.monochrome && !isRasterTilePlanDownscaled(source, plan);
  return estimateRasterTilePlanBytes(plan, packed, format, !!source.monochrome && !!source.reducedMonochrome && !packed);
}

/**
 * Fit aggregate display demand before GPU allocation. Screen-sized requests share
 * a resolution scale, including binary images. Legacy requests without display
 * bounds preserve fitting packed images. Eligible images try compression first.
 * `availableBytes` is an internal reservation, never a required user setting.
 */
export function planSceneRasterMemory(
  sources: readonly RasterMemorySource[],
  maxTextureSize: number,
  availableBytes?: number,
  compressionFormat?: RasterCompressionFormat | null
): SceneRasterMemoryPlan {
  const budget = automaticRasterMemoryBudget();
  const available = availableBytes === undefined || !Number.isFinite(availableBytes)
    ? budget.bytes
    : Math.max(0, Math.min(budget.bytes, Math.floor(availableBytes)));
  const originalPlans = sources.map(source => {
    validateDimensions(source.width, source.height);
    const width = source.displayWidth === undefined ? source.width : Math.max(1, Math.min(source.width, Math.floor(source.displayWidth)));
    const height = source.displayHeight === undefined ? source.height : Math.max(1, Math.min(source.height, Math.floor(source.displayHeight)));
    validateDimensions(width, height);
    return planRasterTiles(width, height, maxTextureSize);
  });
  const packed = sources.map((source, index) => !!source.monochrome && source.displayWidth === undefined &&
    !isRasterTilePlanDownscaled(source, originalPlans[index]));
  const copies = sources.map(source => Number.isFinite(source.allocationCopies) && source.allocationCopies! >= 1
    ? Math.ceil(source.allocationCopies!) : 1);
  const costs = originalPlans.map((plan, index) => plannedSourceBytes(sources[index], plan) * copies[index]);
  const unscaledBytes = costs.reduce((sum, cost) => sum + cost, 0);
  const protectedBytes = costs.reduce((sum, cost, index) => sum + (packed[index] ? cost : 0), 0);
  const result = (
    plans: RasterTilePlan[], estimatedBytes: number, resolutionScale: number,
    compressionFormats: (RasterCompressionFormat | null)[]
  ): SceneRasterMemoryPlan =>
    ({ plans, compressionFormats, budget, availableBytes: available, unscaledBytes, estimatedBytes, protectedBytes,
      resolutionScale, overBudget: estimatedBytes > available });
  if (unscaledBytes <= available || packed.every(Boolean)) {
    return result(originalPlans, unscaledBytes, 1, sources.map(() => null));
  }

  const price = (plans: RasterTilePlan[]) => {
    const compressionFormats = plans.map((plan, index): RasterCompressionFormat | null => {
      if (!compressionFormat || packed[index] || sources[index].monochrome || !sources[index].compressionEligible) return null;
      // Block padding and terminal mips can outweigh savings for a tiny reduced image.
      return estimateRasterTilePlanBytes(plan, false, compressionFormat) < estimateRasterTilePlanBytes(plan, false)
        ? compressionFormat : null;
    });
    const bytes = plans.reduce((sum, plan, index) => sum + (packed[index] ? costs[index] :
      plannedSourceBytes(sources[index], plan, compressionFormats[index]) * copies[index]), 0);
    return { plans, bytes, compressionFormats };
  };
  const compressed = price(originalPlans);
  if (compressed.bytes <= available) return result(originalPlans, compressed.bytes, 1, compressed.compressionFormats);

  const atScale = (scale: number) => {
    const plans = originalPlans.map((plan, index) => packed[index] ? plan : planRasterTiles(
      Math.max(1, Math.floor(plan.width * scale)),
      Math.max(1, Math.floor(plan.height * scale)),
      maxTextureSize
    ));
    return price(plans);
  };
  let low = 0, high = 1;
  let selected = atScale(0);
  if (selected.bytes > available) return result(selected.plans, selected.bytes, 0, selected.compressionFormats);
  // Search actual tile/mip bytes, rather than a square-root approximation that misses gutters and strips.
  for (let iteration = 0; iteration < 32; iteration++) {
    const scale = (low + high) / 2;
    const candidate = atScale(scale);
    if (candidate.bytes <= available) {
      low = scale;
      selected = candidate;
    } else high = scale;
  }
  return result(selected.plans, selected.bytes, low, selected.compressionFormats);
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
  const compressedCount = plan.compressionFormats.filter(Boolean).length;
  if (plan.resolutionScale >= 1 && !plan.overBudget && !compressedCount) return;
  const key = `${plan.budget.bytes}:${plan.availableBytes}:${plan.unscaledBytes}:${plan.estimatedBytes}:${plan.protectedBytes}:${plan.compressionFormats.join(",")}`;
  if (owner ? reportedPlans.get(owner) === key : reportedUnownedPlans.has(key)) return;
  if (owner) reportedPlans.set(owner, key);
  else reportedUnownedPlans.add(key);
  const origin = plan.budget.deviceMemoryGiB === null ? "a conservative fallback" :
    `${plan.budget.deviceMemoryGiB} GiB of reported device RAM`;
  console.warn(`[HEPR] Raster GPU demand is estimated at ${Math.ceil(plan.unscaledBytes / MIB)} MiB; ` +
    `the automatic resident raster target is ${Math.ceil(plan.availableBytes / MIB)} MiB, estimated from ${origin}, not measured VRAM. ` +
    (compressedCount ? `Using ${plan.compressionFormats.find(Boolean)} GPU compression for ${compressedCount} eligible raster(s). ` : "") +
    (plan.resolutionScale < 1 ? `Drawing rasters at reduced resolution (${Math.ceil(plan.estimatedBytes / MIB)} MiB estimated). ` : "") +
    (plan.overBudget ? "Keeping lossless packed rasters and minimum textures even though they exceed this heuristic target." : ""));
}
