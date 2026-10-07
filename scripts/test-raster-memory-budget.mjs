import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const MIB = 1024 * 1024;
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalWarn = console.warn;

try {
  const {
    automaticRasterMemoryBudget, estimateRasterTextureBytes, estimateRasterTilePlanBytes,
    planSceneRasterMemory, reportRasterMemoryBudget
  } = await import("../src/rasterMemoryBudget.ts");
  const { planRasterTiles, sameRasterTilePlan } = await import("../src/rasterTiles.ts");

  // deviceMemory is a coarse system-RAM hint; all missing or inaccessible hints use the same fallback.
  for (const deviceMemory of [undefined, null, "8", 0, -1, NaN, Infinity]) {
    setNavigator({ deviceMemory });
    assert.deepEqual(automaticRasterMemoryBudget(), { bytes: 64 * MIB, peakBytes: 128 * MIB,
      deviceMemoryGiB: null, source: "fallback" });
  }
  setNavigator(undefined);
  assert.equal(automaticRasterMemoryBudget().source, "fallback", "Node and other hosts need no navigator global");
  setNavigator({ get deviceMemory() { throw new Error("Restricted browser property"); } });
  assert.equal(automaticRasterMemoryBudget().bytes, 64 * MIB);
  Object.defineProperty(globalThis, "navigator", { configurable: true, get() { throw new Error("Unavailable navigator"); } });
  assert.equal(automaticRasterMemoryBudget().bytes, 64 * MIB);
  for (const [deviceMemory, expectedMiB] of [[0.25, 16], [0.5, 16], [1, 32], [2, 64], [4, 128], [8, 256], [64, 256]]) {
    setNavigator({ deviceMemory });
    const budget = automaticRasterMemoryBudget();
    assert.equal(budget.bytes, expectedMiB * MIB);
    assert.equal(budget.peakBytes, budget.bytes * 2, "atomic replacement has one additional resident allowance");
    assert.equal(budget.deviceMemoryGiB, deviceMemory);
    assert.equal(budget.source, "device-memory");
  }

  assert.equal(estimateRasterTextureBytes(1, 1, false), 4);
  assert.equal(estimateRasterTextureBytes(1, 1, true), 2, "packed 1x1 also binds a dummy complete coverage texture");
  assert.equal(estimateRasterTextureBytes(3, 5, false), 72);
  assert.equal(estimateRasterTextureBytes(3, 5, true), 8);
  assert.equal(estimateRasterTextureBytes(257, 1, false), 2048);
  assert.equal(estimateRasterTextureBytes(257, 1, true), 288);
  assert.equal(estimateRasterTextureBytes(1, 257, true), 512);
  for (const [width, height] of [[Infinity, 1], [1, NaN], [-1, 2], [0, 1], [2.5, 1], [Number.MAX_SAFE_INTEGER, 2]]) {
    assert.throws(() => estimateRasterTextureBytes(width, height, false), RangeError);
  }
  const seamPlan = planRasterTiles(9000, 1, 8192);
  assert.deepEqual(seamPlan.tiles.map(tile => tile.width), [8128, 1000]);
  for (const packed of [false, true]) {
    const tileBytes = estimateRasterTilePlanBytes(seamPlan, packed);
    assert.equal(tileBytes, estimateRasterTextureBytes(8128, 1, packed) + estimateRasterTextureBytes(1000, 1, packed));
    assert(tileBytes > estimateRasterTextureBytes(9000, 1, packed), "seam gutters are charged as duplicate texels and mipmaps");
  }

  setNavigator({ deviceMemory: 1 });
  const smallSources = [{ width: 1, height: 1 }, { width: 3, height: 5 }, { width: 17, height: 17, monochrome: {} }];
  const small = planSceneRasterMemory(smallSources, 8192);
  assert.equal(small.resolutionScale, 1);
  assert.equal(small.overBudget, false);
  small.plans.forEach((plan, index) => assert.deepEqual(plan, planRasterTiles(smallSources[index].width, smallSources[index].height, 8192)));
  assert.equal(planSceneRasterMemory([], 8192).estimatedBytes, 0);
  assert.throws(() => planSceneRasterMemory([{ width: Infinity, height: 1 }], 8192), RangeError);

  // Identical content demand behaves differently as the automatically observed RAM changes.
  const largeSource = { width: 4096, height: 4096 };
  const lowRam = planSceneRasterMemory([largeSource], 8192);
  assert(lowRam.resolutionScale < 1);
  assert(lowRam.estimatedBytes <= lowRam.budget.bytes);
  setNavigator({ deviceMemory: 4 });
  const highRam = planSceneRasterMemory([largeSource], 8192);
  assert.equal(highRam.resolutionScale, 1);
  assert(highRam.plans[0].width > lowRam.plans[0].width);

  // More images share the same target, rather than each independently consuming a full device-size texture.
  setNavigator({ deviceMemory: 1 });
  const many = planSceneRasterMemory(Array.from({ length: 4 }, () => largeSource), 8192);
  assert(many.resolutionScale < lowRam.resolutionScale);
  assert(many.plans.every(plan => plan.width === many.plans[0].width && plan.height === many.plans[0].height));
  assert(many.estimatedBytes <= many.availableBytes);
  assert.equal(many.unscaledBytes, estimateRasterTextureBytes(4096, 4096, false) * 4);
  assert.equal(many.estimatedBytes, many.plans.reduce((sum, plan) => sum + estimateRasterTilePlanBytes(plan, false), 0));
  const duplicated = planSceneRasterMemory([{ ...largeSource, allocationCopies: 2 }], 8192);
  assert.equal(duplicated.unscaledBytes, lowRam.unscaledBytes * 2);
  assert(duplicated.plans[0].width < lowRam.plans[0].width, "resident batching duplicates consume real budget");

  // Planning never evaluates lazy RGBA, and retains exact packed binary textures under memory pressure.
  const protectedSource = { width: 4096, height: 4096, monochrome: {},
    get data() { throw new Error("Planning must not expand packed pixels"); } };
  const mixed = planSceneRasterMemory([protectedSource, largeSource, largeSource], 8192);
  assert.equal(mixed.plans[0].width, protectedSource.width);
  assert.equal(mixed.plans[0].height, protectedSource.height);
  assert.equal(mixed.protectedBytes, estimateRasterTextureBytes(4096, 4096, true));
  assert(mixed.plans[1].width < 4096);
  assert(mixed.estimatedBytes <= mixed.availableBytes);
  const packedOverflow = planSceneRasterMemory(Array.from({ length: 8 }, () => protectedSource), 8192);
  assert.equal(packedOverflow.overBudget, true);
  assert.equal(packedOverflow.resolutionScale, 1);
  assert(packedOverflow.plans.every(plan => plan.width === 4096 && plan.height === 4096),
    "a heuristic target does not deny or reduce lossless packed documents");

  // A device-forced reduction already uses the RGBA fallback and must be charged as RGBA.
  setNavigator({ deviceMemory: 8 });
  const deviceReduced = planSceneRasterMemory([{ width: 100, height: 100, monochrome: {} }], 64);
  assert.equal(deviceReduced.protectedBytes, 0);
  assert.equal(deviceReduced.estimatedBytes, estimateRasterTilePlanBytes(deviceReduced.plans[0], false));

  // Internal reservations constrain replacements without changing the automatic observation or source geometry.
  setNavigator({ deviceMemory: 1 });
  const reserved = planSceneRasterMemory([largeSource], 8192, 8 * MIB);
  assert.equal(reserved.budget.bytes, 32 * MIB);
  assert.equal(reserved.availableBytes, 8 * MIB);
  assert(reserved.plans[0].width < lowRam.plans[0].width);
  assert(reserved.estimatedBytes <= 8 * MIB);
  assert.equal(planSceneRasterMemory([largeSource], 8192, Infinity).availableBytes, 32 * MIB);
  assert.equal(planSceneRasterMemory([largeSource], 8192, 256 * MIB).availableBytes, 32 * MIB);
  const minimum = planSceneRasterMemory([{ width: 2, height: 2 }], 8192, 0);
  assert.equal(minimum.overBudget, true);
  assert.deepEqual([minimum.plans[0].width, minimum.plans[0].height], [1, 1]);
  const packedWithNoRoom = planSceneRasterMemory([protectedSource, largeSource], 8192, 0);
  assert.equal(packedWithNoRoom.plans[0].width, 4096);
  assert.equal(packedWithNoRoom.plans[1].width, 1);
  assert.equal(packedWithNoRoom.overBudget, true);
  assert.equal(largeSource.width, 4096);
  assert.equal(largeSource.height, 4096);
  assert(sameRasterTilePlan(planSceneRasterMemory([largeSource], 8192).plans[0], lowRam.plans[0]),
    "restoring residency reproduces the same plan when observed RAM and demand are unchanged");

  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  const owner = {};
  reportRasterMemoryBudget(small, owner);
  assert.equal(warnings.length, 0);
  reportRasterMemoryBudget(lowRam, owner);
  reportRasterMemoryBudget(lowRam, owner);
  assert.equal(warnings.length, 1, "unchanged ownership/residency does not repeat the diagnostic");
  assert.match(warnings[0], /reported device RAM, not measured VRAM/);
  assert.match(warnings[0], /reduced resolution/);
  reportRasterMemoryBudget(packedOverflow, owner);
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /Keeping lossless packed rasters/);
  console.log("Automatic raster memory: safe RAM hints, bounded targets, exact mip/gutter costs, aggregate demand, lossless priority, allocation copies, staging reservations and diagnostics passed.");
} finally {
  console.warn = originalWarn;
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else delete globalThis.navigator;
  hooks.deregister();
}

function setNavigator(navigator) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
}
