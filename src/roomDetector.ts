import {
  decodeStrokeStyleMeta,
  STROKE_STYLE_FLAG_HAIRLINE,
  type SceneTextItem,
  type VectorScene
} from "./pdfVectorExtractor";

/**
 * A seed point for room detection, in scene coordinates. Detection flood-fills the open
 * space around each seed; seeds that do not sit inside a wall-bounded region are
 * discarded and reported in `RoomDetectionResult.failedSeeds`.
 */
export interface RoomSeed {
  x: number;
  y: number;
  label?: string;
  /** Index into `VectorScene.pageRects`. Omit to locate the page from the position. */
  pageIndex?: number;
}

/**
 * Options for `detectRooms`. All thresholds are adaptive by default; the resolved values
 * are reported per page in `RoomDetectionDebugInfo.pageStats` when `collectDebugInfo` is
 * enabled.
 */
export interface RoomDetectionOptions {
  /** Pages to process. Defaults to every page in the scene. */
  pageIndexes?: number[];

  /** Seed points to flood-fill from. Defaults to seeds derived from `scene.textContent`. */
  seeds?: RoomSeed[];

  /**
   * Absolute wall stroke half-width threshold in scene units. Overrides the adaptive
   * threshold derived from the stroke width distribution.
   */
  wallHalfWidthThreshold?: number;

  /**
   * Fraction of the page's total stroke length that must be at least as thick as the
   * detected wall width class. The adaptive threshold walks the stroke-width histogram
   * from thickest to thinnest and stops once this much cumulative length is covered.
   *
   * @default 0.06
   */
  wallCoverageFraction?: number;

  /**
   * The wall half-width threshold is this ratio of the detected wall width class, so
   * slightly thinner partition walls are still accepted.
   *
   * @default 0.7
   */
  wallWidthRatio?: number;

  /**
   * Maximum door-opening gap to bridge with virtual closure segments, expressed as a
   * multiple of the median wall full width.
   *
   * @default 12
   */
  doorGapFactor?: number;

  /**
   * Raster resolution cap for the occupancy bitmap, in pixels on the longest page side.
   *
   * @default 4096
   */
  maxRasterSize?: number;

  /**
   * Regions larger than this fraction of the page raster are considered leaks (e.g. the
   * space around the building) and discarded.
   *
   * @default 0.35
   */
  maxRoomAreaFraction?: number;

  /**
   * Regions smaller than this many raster pixels are discarded as noise.
   *
   * @default 25
   */
  minRoomAreaPixels?: number;

  /**
   * Douglas-Peucker simplification tolerance for traced contours, in raster pixels.
   *
   * @default 1.5
   */
  simplifyTolerancePx?: number;

  /**
   * Polygon edges within this angle of horizontal/vertical are snapped to axis-aligned.
   *
   * @default 4
   */
  axisSnapAngleDegrees?: number;

  /**
   * Snap polygon edges onto the inner faces of nearby parallel wall strokes to recover
   * sub-raster precision.
   *
   * @default true
   */
  snapToWallLines?: boolean;

  /**
   * Also detect enclosed regions that contain no text label (or no seed at all), by
   * sampling the page on a coarse grid. Unlabeled rooms have an empty `labelText` and
   * their label position at the polygon centroid. Hollow wall bands and other thin
   * enclosed slivers are filtered out by a region-thickness heuristic.
   *
   * @default true
   */
  detectUnlabeledRooms?: boolean;

  /** Collect `RoomDetectionDebugInfo` (wall candidates, closures, raw contours, stats). */
  collectDebugInfo?: boolean;
}

/** One detected room. */
export interface DetectedRoom {
  pageIndex: number;
  /** Closed polygon as [x0, y0, x1, y1, ...] in scene coordinates, CCW winding. */
  polygon: Float32Array;
  /** Enclosed area in scene units squared. */
  area: number;
  /** Merged label text of all seeds inside the room, topmost line first, joined with newlines. */
  labelText: string;
  labelX: number;
  labelY: number;
  /** The text items whose seeds landed in this room (empty for caller-provided seeds). */
  labels: SceneTextItem[];
}

export type RoomSeedFailureReason =
  | "outsidePage"
  | "onWall"
  | "leaked"
  | "tooLarge"
  | "tooSmall"
  | "duplicate"
  | "noWalls";

export interface RoomSeedFailure {
  seed: RoomSeed;
  reason: RoomSeedFailureReason;
}

/** Per-page diagnostics and resolved adaptive thresholds. */
export interface RoomDetectionPageStats {
  pageIndex: number;
  eligibleSegmentCount: number;
  totalStrokeLength: number;
  /** Stroke half-width classes with the total stroke length drawn at each width. */
  widthHistogram: { halfWidth: number; totalLength: number; segmentCount: number }[];
  wallHalfWidthThreshold: number;
  /** Length-weighted median half-width of the accepted wall segments. */
  wallMedianHalfWidth: number;
  wallSegmentCount: number;
  doorGapMax: number;
  /** Number of virtual closure segments bridging door openings and wall gaps. */
  closureCount: number;
  rasterScale: number;
  rasterWidth: number;
  rasterHeight: number;
  seedCount: number;
}

/** Raster-space flood fill state of one page, for debug visualization. */
export interface RoomDetectionRegionDebug {
  width: number;
  height: number;
  /** Raster pixels per scene unit. */
  scale: number;
  /** Scene coordinates of the raster origin (top-left pixel, Y-down raster). */
  originX: number;
  originY: number;
  /** Per-pixel region ids; `exteriorRegionId` marks border-connected space. */
  regionMap: Uint16Array;
  exteriorRegionId: number;
  /** Per region id: 0 = unused, 1 = room, 2 = failed/rejected. */
  regionStatus: Uint8Array;
}

export interface RoomDetectionDebugInfo {
  /** Wall candidate subsegments as [x0, y0, x1, y1] runs, scene coordinates. */
  wallSegments: Float32Array;
  /** Virtual door-gap closures as [x0, y0, x1, y1] runs, scene coordinates. */
  virtualClosures: Float32Array;
  /** Traced contours before simplification, one closed [x, y, ...] run per room. */
  rawContours: Float32Array[];
  pageStats: Map<number, RoomDetectionPageStats>;
  regionDebug: Map<number, RoomDetectionRegionDebug>;
}

export interface RoomDetectionResult {
  rooms: DetectedRoom[];
  failedSeeds: RoomSeedFailure[];
  seedSource: "textContent" | "provided" | "none";
  debug?: RoomDetectionDebugInfo;
}

interface ResolvedOptions {
  wallHalfWidthThreshold: number | null;
  wallCoverageFraction: number;
  wallWidthRatio: number;
  doorGapFactor: number;
  maxRasterSize: number;
  maxRoomAreaFraction: number;
  minRoomAreaPixels: number;
  simplifyTolerancePx: number;
  axisSnapAngleDegrees: number;
  snapToWallLines: boolean;
  detectUnlabeledRooms: boolean;
}

interface PageSeed {
  x: number;
  y: number;
  label: string;
  item: SceneTextItem | null;
  /** How far (scene units) to search for a free pixel around the seed point. */
  probeRadius: number;
  asRoomSeed: RoomSeed;
}

const WALL_STRIDE = 5; // x0, y0, x1, y1, halfWidth
const MAX_SEEDS_PER_PAGE = 4000;
const MAX_LABEL_LENGTH = 60;
const RASTER_PAD = 2;
/** Reserved region id for the space connected to the page border. */
const EXTERIOR_REGION_ID = 65535;

/**
 * Detect rooms (closed wall-bounded regions) on architectural floorplan pages.
 *
 * The detector classifies thick strokes as wall candidates, bridges door openings with
 * virtual closure segments, rasterizes the walls into an occupancy bitmap, flood-fills
 * from each seed (by default the centers of extracted text labels), traces the region
 * contours, and simplifies/snap the polygons back onto the inner wall faces.
 *
 * Seeds default to `scene.textContent`, which is only present when the scene was parsed
 * from a PDF source with text extraction enabled (`extractText` / `extractTextContent`).
 *
 * Example:
 *
 * ```ts
 * const loaded = await loadPdfSceneFromSource(file, { extractText: true });
 * const result = detectRooms(loaded.scene);
 * for (const room of result.rooms) {
 *   console.log(room.labelText, room.area, room.polygon);
 * }
 * ```
 */
export function detectRooms(scene: VectorScene, options: RoomDetectionOptions = {}): RoomDetectionResult {
  const resolved: ResolvedOptions = {
    wallHalfWidthThreshold: normalizePositive(options.wallHalfWidthThreshold, null),
    wallCoverageFraction: normalizePositive(options.wallCoverageFraction, 0.06),
    wallWidthRatio: normalizePositive(options.wallWidthRatio, 0.7),
    doorGapFactor: normalizePositive(options.doorGapFactor, 12),
    maxRasterSize: Math.max(256, Math.trunc(normalizePositive(options.maxRasterSize, 4096))),
    maxRoomAreaFraction: normalizePositive(options.maxRoomAreaFraction, 0.35),
    minRoomAreaPixels: Math.max(1, Math.trunc(normalizePositive(options.minRoomAreaPixels, 25))),
    simplifyTolerancePx: normalizePositive(options.simplifyTolerancePx, 1.5),
    axisSnapAngleDegrees: normalizePositive(options.axisSnapAngleDegrees, 4),
    snapToWallLines: options.snapToWallLines !== false,
    detectUnlabeledRooms: options.detectUnlabeledRooms !== false
  };

  const pageCount = Math.max(1, Math.floor(scene.pageRects.length / 4));
  const pageIndexes = (options.pageIndexes ?? rangeArray(pageCount)).filter(
    (pageIndex) => Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < pageCount
  );

  const providedSeeds = options.seeds ?? null;
  const seedSource: RoomDetectionResult["seedSource"] = providedSeeds
    ? "provided"
    : scene.textContent && scene.textContent.length > 0
      ? "textContent"
      : "none";

  const collectDebug = options.collectDebugInfo === true;
  const debug: RoomDetectionDebugInfo | undefined = collectDebug
    ? {
      wallSegments: new Float32Array(0),
      virtualClosures: new Float32Array(0),
      rawContours: [],
      pageStats: new Map(),
      regionDebug: new Map()
    }
    : undefined;
  const debugWallSegments: number[] = [];
  const debugClosures: number[] = [];

  const rooms: DetectedRoom[] = [];
  const failedSeeds: RoomSeedFailure[] = [];

  interface PageAttempt {
    rooms: DetectedRoom[];
    failedSeeds: RoomSeedFailure[];
    debug: RoomDetectionDebugInfo | undefined;
    debugWalls: number[];
    debugClosures: number[];
  }

  const runPage = (pageIndex: number, pageOptions: ResolvedOptions): PageAttempt => {
    const attempt: PageAttempt = {
      rooms: [],
      failedSeeds: [],
      debug: collectDebug
        ? { wallSegments: new Float32Array(0), virtualClosures: new Float32Array(0), rawContours: [], pageStats: new Map(), regionDebug: new Map() }
        : undefined,
      debugWalls: [],
      debugClosures: []
    };
    detectRoomsOnPage(scene, pageIndex, pageOptions, providedSeeds, attempt.rooms, attempt.failedSeeds, attempt.debug, attempt.debugWalls, attempt.debugClosures);
    return attempt;
  };

  const countLabeledRooms = (attempt: PageAttempt): number => attempt.rooms.filter((room) => room.labels.length > 0).length;

  for (const pageIndex of pageIndexes) {
    let attempt = runPage(pageIndex, resolved);

    // If nearly every label seed leaked, the width-based wall classifier most likely
    // picked the wrong stroke class (drawings with uniform line widths). Retry treating
    // every eligible stroke as a wall and keep the attempt that explains more labels.
    if (resolved.wallHalfWidthThreshold === null) {
      const labelSeedCount = attempt.rooms.reduce((count, room) => count + room.labels.length, 0) + attempt.failedSeeds.length;
      const leakedCount = attempt.failedSeeds.filter((failure) => failure.reason === "leaked" || failure.reason === "noWalls").length;
      if (labelSeedCount >= 10 && leakedCount / labelSeedCount > 0.8) {
        const retry = runPage(pageIndex, { ...resolved, wallHalfWidthThreshold: 1e-9 });
        if (countLabeledRooms(retry) > countLabeledRooms(attempt)) {
          attempt = retry;
        }
      }
    }

    for (const room of attempt.rooms) {
      rooms.push(room);
    }
    for (const failure of attempt.failedSeeds) {
      failedSeeds.push(failure);
    }
    if (debug && attempt.debug) {
      for (const value of attempt.debugWalls) {
        debugWallSegments.push(value);
      }
      for (const value of attempt.debugClosures) {
        debugClosures.push(value);
      }
      for (const contour of attempt.debug.rawContours) {
        debug.rawContours.push(contour);
      }
      for (const [statsPage, stats] of attempt.debug.pageStats) {
        debug.pageStats.set(statsPage, stats);
      }
      for (const [regionPage, regionDebug] of attempt.debug.regionDebug) {
        debug.regionDebug.set(regionPage, regionDebug);
      }
    }
  }

  if (debug) {
    debug.wallSegments = new Float32Array(debugWallSegments);
    debug.virtualClosures = new Float32Array(debugClosures);
  }

  return { rooms, failedSeeds, seedSource, ...(debug ? { debug } : {}) };
}

function detectRoomsOnPage(
  scene: VectorScene,
  pageIndex: number,
  options: ResolvedOptions,
  providedSeeds: RoomSeed[] | null,
  rooms: DetectedRoom[],
  failedSeeds: RoomSeedFailure[],
  debug: RoomDetectionDebugInfo | undefined,
  debugWallSegments: number[],
  debugClosures: number[]
): void {
  const rectOffset = pageIndex * 4;
  const pageMinX = scene.pageRects[rectOffset];
  const pageMinY = scene.pageRects[rectOffset + 1];
  const pageMaxX = scene.pageRects[rectOffset + 2];
  const pageMaxY = scene.pageRects[rectOffset + 3];
  const pageWidth = pageMaxX - pageMinX;
  const pageHeight = pageMaxY - pageMinY;
  if (!(pageWidth > 0) || !(pageHeight > 0)) {
    return;
  }
  const pageDiagonal = Math.hypot(pageWidth, pageHeight);

  const seeds = collectPageSeeds(scene, pageIndex, pageMinX, pageMinY, pageMaxX, pageMaxY, providedSeeds);

  // Stage A: wall candidate filtering by stroke width statistics.
  const stageA = collectWallSegments(scene, pageIndex, pageMinX, pageMinY, pageMaxX, pageMaxY, pageDiagonal, options);
  const stats: RoomDetectionPageStats = {
    pageIndex,
    eligibleSegmentCount: stageA.eligibleSegmentCount,
    totalStrokeLength: stageA.totalStrokeLength,
    widthHistogram: stageA.widthHistogram,
    wallHalfWidthThreshold: stageA.wallHalfWidthThreshold,
    wallMedianHalfWidth: stageA.wallMedianHalfWidth,
    wallSegmentCount: stageA.walls.length / WALL_STRIDE,
    doorGapMax: 0,
    closureCount: 0,
    rasterScale: 0,
    rasterWidth: 0,
    rasterHeight: 0,
    seedCount: seeds.length
  };
  debug?.pageStats.set(pageIndex, stats);

  const wallCount = stageA.walls.length / WALL_STRIDE;
  if (wallCount === 0 || !(stageA.wallMedianHalfWidth > 0)) {
    for (const seed of seeds) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: "noWalls" });
    }
    return;
  }
  const walls = stageA.walls;

  if (debug) {
    for (let i = 0; i < wallCount; i += 1) {
      const base = i * WALL_STRIDE;
      debugWallSegments.push(walls[base], walls[base + 1], walls[base + 2], walls[base + 3]);
    }
  }

  // Resolved gap thresholds. The page-diagonal floor matters for drawings whose wall
  // strokes are hairline-thin: door openings still have architectural proportions.
  const wallWidth = stageA.wallMedianHalfWidth * 2;
  const doorGapMax = Math.min(Math.max(options.doorGapFactor * wallWidth, 0.0055 * pageDiagonal), 0.025 * pageDiagonal);
  let maxWallHalfWidth = 0;
  for (let i = 0; i < wallCount; i += 1) {
    maxWallHalfWidth = Math.max(maxWallHalfWidth, walls[i * WALL_STRIDE + 4]);
  }
  const grid = new WallGrid(walls, wallCount, pageMinX, pageMinY, pageMaxX, pageMaxY, Math.max(doorGapMax, wallWidth * 4));

  // Stage C: rasterize walls into an occupancy bitmap.
  const scale = options.maxRasterSize / Math.max(pageWidth, pageHeight);
  const rasterWidth = Math.max(4, Math.ceil(pageWidth * scale) + RASTER_PAD * 2);
  const rasterHeight = Math.max(4, Math.ceil(pageHeight * scale) + RASTER_PAD * 2);
  stats.rasterScale = scale;
  stats.rasterWidth = rasterWidth;
  stats.rasterHeight = rasterHeight;

  const occupancy = new Uint8Array(rasterWidth * rasterHeight);
  const worldToRasterX = (wx: number): number => (wx - pageMinX) * scale + RASTER_PAD;
  const worldToRasterY = (wy: number): number => (pageMaxY - wy) * scale + RASTER_PAD;
  const rasterToWorldX = (rx: number): number => pageMinX + (rx - RASTER_PAD) / scale;
  const rasterToWorldY = (ry: number): number => pageMaxY - (ry - RASTER_PAD) / scale;

  for (let i = 0; i < wallCount; i += 1) {
    const base = i * WALL_STRIDE;
    stampSegment(
      occupancy,
      rasterWidth,
      rasterHeight,
      worldToRasterX(walls[base]),
      worldToRasterY(walls[base + 1]),
      worldToRasterX(walls[base + 2]),
      worldToRasterY(walls[base + 3]),
      Math.max(walls[base + 4] * scale, 0.875)
    );
  }

  // Stage B: bridge door openings by extending wall ends until they contact other walls.
  const closures = buildWhiskerClosures(walls, wallCount, grid, wallWidth, maxWallHalfWidth, doorGapMax, {
    occupancy,
    width: rasterWidth,
    height: rasterHeight,
    scale,
    worldToRasterX,
    worldToRasterY
  });
  stats.doorGapMax = doorGapMax;
  stats.closureCount = closures.length / WALL_STRIDE;
  if (debug) {
    for (let i = 0; i + 4 < closures.length + 1; i += WALL_STRIDE) {
      debugClosures.push(closures[i], closures[i + 1], closures[i + 2], closures[i + 3]);
    }
  }
  for (let i = 0; i + 4 < closures.length + 1; i += WALL_STRIDE) {
    stampSegment(
      occupancy,
      rasterWidth,
      rasterHeight,
      worldToRasterX(closures[i]),
      worldToRasterY(closures[i + 1]),
      worldToRasterX(closures[i + 2]),
      worldToRasterY(closures[i + 3]),
      Math.max(closures[i + 4] * scale, 0.875)
    );
  }

  // Close small gaps: walls drawn as two parallel face strokes leave a hollow band that
  // would otherwise be detected as a snaking enclosed region, and dashed wall pieces
  // leave pinholes. The radius stays well below door-opening widths.
  morphologicalClose(
    occupancy,
    rasterWidth,
    rasterHeight,
    Math.min(Math.max(1.5 * wallWidth * scale, 2.5), 0.15 * doorGapMax * scale, 12)
  );

  // Stage D: flood fill from each seed.
  const regionMap = new Uint16Array(rasterWidth * rasterHeight);
  const maxRegionPixels = Math.max(options.minRoomAreaPixels, Math.floor(options.maxRoomAreaFraction * rasterWidth * rasterHeight));

  // Pre-fill everything reachable from the page border as "exterior", so leaking seeds
  // fail immediately instead of flooding (and possibly truncating at) huge areas.
  for (let x = 0; x < rasterWidth; x += 1) {
    for (const index of [x, (rasterHeight - 1) * rasterWidth + x]) {
      if (occupancy[index] === 0 && regionMap[index] === 0) {
        floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, index, EXTERIOR_REGION_ID, Number.MAX_SAFE_INTEGER, -1);
      }
    }
  }
  for (let y = 0; y < rasterHeight; y += 1) {
    for (const index of [y * rasterWidth, y * rasterWidth + rasterWidth - 1]) {
      if (occupancy[index] === 0 && regionMap[index] === 0) {
        floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, index, EXTERIOR_REGION_ID, Number.MAX_SAFE_INTEGER, -1);
      }
    }
  }
  interface RegionRecord {
    failure: RoomSeedFailureReason | null;
    roomIndex: number;
    auto: boolean;
    pixelCount: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    seeds: PageSeed[];
  }
  const regions: RegionRecord[] = [];
  let nextRegionId = 1;

  for (const seed of seeds) {
    const sx = Math.round(worldToRasterX(seed.x));
    const sy = Math.round(worldToRasterY(seed.y));
    if (sx < 0 || sy < 0 || sx >= rasterWidth || sy >= rasterHeight) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: "outsidePage" });
      continue;
    }

    const probeRadiusPx = Math.min(28, Math.max(8, Math.round(seed.probeRadius * scale)));
    const probe = probeFreePixel(occupancy, regionMap, rasterWidth, rasterHeight, sx, sy, probeRadiusPx);
    if (probe < 0) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: "onWall" });
      continue;
    }

    const existingId = regionMap[probe];
    if (existingId === EXTERIOR_REGION_ID) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: "leaked" });
      continue;
    }
    if (existingId !== 0) {
      const region = regions[existingId - 1];
      if (region.failure) {
        failedSeeds.push({ seed: seed.asRoomSeed, reason: region.failure });
      } else {
        region.seeds.push(seed);
      }
      continue;
    }

    if (nextRegionId >= EXTERIOR_REGION_ID) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: "tooLarge" });
      continue;
    }
    const regionId = nextRegionId;
    nextRegionId += 1;
    const fill = floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, probe, regionId, maxRegionPixels, EXTERIOR_REGION_ID);
    const region: RegionRecord = {
      failure: null,
      roomIndex: -1,
      auto: false,
      pixelCount: fill.pixelCount,
      minX: fill.minX,
      minY: fill.minY,
      maxX: fill.maxX,
      maxY: fill.maxY,
      seeds: [seed]
    };
    regions.push(region);

    if (fill.aborted) {
      region.failure = "tooLarge";
    } else if (fill.touchedBorder) {
      region.failure = "leaked";
    } else if (fill.pixelCount < options.minRoomAreaPixels) {
      region.failure = "tooSmall";
    }
    if (region.failure) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: region.failure });
    }
  }

  // Unlabeled rooms: sample the remaining free space on a coarse grid; thin or tiny
  // regions (hollow wall bands, junction pockets) are rejected after contour tracing.
  const autoMinAreaPixels = Math.max(options.minRoomAreaPixels, Math.round((doorGapMax * scale) ** 2));
  const autoMinThicknessPx = Math.max(3, 2.5 * wallWidth * scale, 0.25 * doorGapMax * scale);
  if (options.detectUnlabeledRooms) {
    const gridStep = Math.max(4, Math.floor(doorGapMax * scale));
    for (let gy = RASTER_PAD + 1; gy < rasterHeight && nextRegionId < EXTERIOR_REGION_ID; gy += gridStep) {
      const rowStart = gy * rasterWidth;
      for (let gx = RASTER_PAD + 1; gx < rasterWidth && nextRegionId < EXTERIOR_REGION_ID; gx += gridStep) {
        const index = rowStart + gx;
        if (occupancy[index] !== 0 || regionMap[index] !== 0) {
          continue;
        }
        const regionId = nextRegionId;
        nextRegionId += 1;
        const fill = floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, index, regionId, maxRegionPixels, EXTERIOR_REGION_ID);
        regions.push({
          failure: fill.aborted ? "tooLarge" : fill.touchedBorder ? "leaked" : fill.pixelCount < autoMinAreaPixels ? "tooSmall" : null,
          roomIndex: -1,
          auto: true,
          pixelCount: fill.pixelCount,
          minX: fill.minX,
          minY: fill.minY,
          maxX: fill.maxX,
          maxY: fill.maxY,
          seeds: []
        });
      }
    }
  }

  // Stages E + F: trace, simplify, and snap one polygon per surviving region.
  const simplifyTolerance = options.simplifyTolerancePx;
  const axisSnapTan = Math.tan((options.axisSnapAngleDegrees * Math.PI) / 180);
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
    const region = regions[regionIndex];
    if (region.failure) {
      continue;
    }
    const regionId = regionIndex + 1;
    const contour = traceRegionContour(regionMap, rasterWidth, rasterHeight, regionId, region.minX, region.minY, region.maxX, region.maxY);
    if (contour.length < 8) {
      region.failure = "tooSmall";
      for (const seed of region.seeds) {
        failedSeeds.push({ seed: seed.asRoomSeed, reason: "tooSmall" });
      }
      continue;
    }

    if (region.auto) {
      // Reject thin enclosed slivers (hollow wall bands, shafts) found by grid sampling,
      // and hole-riddled shells whose pixels cover little of their outer contour.
      let perimeter = 0;
      for (let i = 0; i + 1 < contour.length; i += 2) {
        const nextIndex = (i + 2) % contour.length;
        perimeter += Math.abs(contour[nextIndex] - contour[i]) + Math.abs(contour[nextIndex + 1] - contour[i + 1]);
      }
      const meanThickness = region.pixelCount / Math.max(1, perimeter / 2);
      const solidity = region.pixelCount / Math.max(1, Math.abs(signedPolygonArea(contour)));
      if (meanThickness < autoMinThicknessPx || solidity < 0.55) {
        region.failure = "tooSmall";
        continue;
      }
    }

    if (debug) {
      const worldContour = new Float32Array(contour.length);
      for (let i = 0; i + 1 < contour.length; i += 2) {
        worldContour[i] = rasterToWorldX(contour[i]);
        worldContour[i + 1] = rasterToWorldY(contour[i + 1]);
      }
      debug.rawContours.push(worldContour);
    }

    let polygon = simplifyClosedPolyline(contour, simplifyTolerance);
    polygon = snapAxisAlignedEdges(polygon, axisSnapTan);
    if (polygon.length < 6) {
      region.failure = "tooSmall";
      for (const seed of region.seeds) {
        failedSeeds.push({ seed: seed.asRoomSeed, reason: "tooSmall" });
      }
      continue;
    }

    // Map raster -> world (this flips Y, i.e. reverses the winding sense).
    const worldPolygon = new Float64Array(polygon.length);
    for (let i = 0; i + 1 < polygon.length; i += 2) {
      worldPolygon[i] = rasterToWorldX(polygon[i]);
      worldPolygon[i + 1] = rasterToWorldY(polygon[i + 1]);
    }

    const finalPolygon = options.snapToWallLines
      ? snapPolygonToWallFaces(worldPolygon, walls, grid, wallWidth, 2.5 / scale)
      : worldPolygon;

    let area = signedPolygonArea(finalPolygon);
    let oriented = finalPolygon;
    if (area < 0) {
      oriented = reversePolygon(finalPolygon);
      area = -area;
    }

    const labels = region.seeds
      .map((seed) => seed.item)
      .filter((item): item is SceneTextItem => item !== null)
      .sort((a, b) => (b.minY + b.maxY) / 2 - (a.minY + a.maxY) / 2);
    const labelTexts = labels.length > 0 ? labels.map((item) => item.text.trim()) : region.seeds.map((seed) => seed.label).filter((label) => label.length > 0);
    const primaryLabel = labels[0] ?? null;
    const anchor = primaryLabel
      ? { x: (primaryLabel.minX + primaryLabel.maxX) / 2, y: (primaryLabel.minY + primaryLabel.maxY) / 2 }
      : region.seeds.length > 0
        ? { x: region.seeds[0].x, y: region.seeds[0].y }
        : polygonCentroid(oriented);

    region.roomIndex = rooms.length;
    rooms.push({
      pageIndex,
      polygon: new Float32Array(oriented),
      area,
      labelText: labelTexts.join("\n"),
      labelX: anchor.x,
      labelY: anchor.y,
      labels
    });
  }

  if (debug) {
    const regionStatus = new Uint8Array(regions.length + 1);
    for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
      regionStatus[regionIndex + 1] = regions[regionIndex].failure ? 2 : 1;
    }
    debug.regionDebug.set(pageIndex, {
      width: rasterWidth,
      height: rasterHeight,
      scale,
      originX: rasterToWorldX(0),
      originY: rasterToWorldY(0),
      regionMap,
      exteriorRegionId: EXTERIOR_REGION_ID,
      regionStatus
    });
  }
}

function collectPageSeeds(
  scene: VectorScene,
  pageIndex: number,
  pageMinX: number,
  pageMinY: number,
  pageMaxX: number,
  pageMaxY: number,
  providedSeeds: RoomSeed[] | null
): PageSeed[] {
  const seeds: PageSeed[] = [];

  if (providedSeeds) {
    for (const seed of providedSeeds) {
      if (!Number.isFinite(seed.x) || !Number.isFinite(seed.y)) {
        continue;
      }
      const inPage = seed.x >= pageMinX && seed.x <= pageMaxX && seed.y >= pageMinY && seed.y <= pageMaxY;
      if (seed.pageIndex !== undefined ? seed.pageIndex === pageIndex : inPage) {
        seeds.push({ x: seed.x, y: seed.y, label: seed.label ?? "", item: null, probeRadius: 0, asRoomSeed: seed });
      }
      if (seeds.length >= MAX_SEEDS_PER_PAGE) {
        break;
      }
    }
    return seeds;
  }

  const textContent = scene.textContent;
  if (!textContent) {
    return seeds;
  }
  for (const item of textContent) {
    if (item.pageIndex !== pageIndex) {
      continue;
    }
    const text = item.text.trim();
    if (text.length === 0 || text.length > MAX_LABEL_LENGTH) {
      continue;
    }
    const x = (item.minX + item.maxX) / 2;
    const y = (item.minY + item.maxY) / 2;
    if (x < pageMinX || x > pageMaxX || y < pageMinY || y > pageMaxY) {
      continue;
    }
    seeds.push({ x, y, label: text, item, probeRadius: 0.75 * (item.maxY - item.minY), asRoomSeed: { x, y, label: text, pageIndex } });
    if (seeds.length >= MAX_SEEDS_PER_PAGE) {
      break;
    }
  }
  return seeds;
}

interface StageAResult {
  walls: Float64Array;
  eligibleSegmentCount: number;
  totalStrokeLength: number;
  widthHistogram: { halfWidth: number; totalLength: number; segmentCount: number }[];
  wallHalfWidthThreshold: number;
  wallMedianHalfWidth: number;
}

function collectWallSegments(
  scene: VectorScene,
  pageIndex: number,
  pageMinX: number,
  pageMinY: number,
  pageMaxX: number,
  pageMaxY: number,
  pageDiagonal: number,
  options: ResolvedOptions
): StageAResult {
  const segmentCount = scene.segmentCount;
  const endpoints = scene.endpoints;
  const primitiveMeta = scene.primitiveMeta;
  const primitiveBounds = scene.primitiveBounds;
  const styles = scene.styles;
  const pageCount = Math.max(1, Math.floor(scene.pageRects.length / 4));
  const margin = 1e-3 * Math.max(pageMaxX - pageMinX, pageMaxY - pageMinY);

  // First pass: stroke-width statistics over eligible (visible, non-hairline) segments.
  const histogramByWidth = new Map<number, { halfWidth: number; totalLength: number; segmentCount: number }>();
  const eligible: number[] = [];
  let totalStrokeLength = 0;

  for (let i = 0; i < segmentCount; i += 1) {
    const base = i * 4;
    if (pageCount > 1) {
      const centerX = (primitiveBounds[base] + primitiveBounds[base + 2]) / 2;
      const centerY = (primitiveBounds[base + 1] + primitiveBounds[base + 3]) / 2;
      if (centerX < pageMinX - margin || centerX > pageMaxX + margin || centerY < pageMinY - margin || centerY > pageMaxY + margin) {
        continue;
      }
    }
    const halfWidth = styles[base];
    if (!(halfWidth > 0)) {
      continue;
    }
    const { alpha, styleFlags } = decodeStrokeStyleMeta(primitiveMeta[base + 3]);
    if (alpha < 0.5 || (styleFlags & STROKE_STYLE_FLAG_HAIRLINE) !== 0) {
      continue;
    }
    const x0 = endpoints[base];
    const y0 = endpoints[base + 1];
    const x1 = primitiveMeta[base];
    const y1 = primitiveMeta[base + 1];
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (!(length > 0)) {
      continue;
    }

    eligible.push(i);
    totalStrokeLength += length;
    const key = Math.round(halfWidth * 4096) / 4096;
    const bucket = histogramByWidth.get(key);
    if (bucket) {
      bucket.totalLength += length;
      bucket.segmentCount += 1;
    } else {
      histogramByWidth.set(key, { halfWidth: key, totalLength: length, segmentCount: 1 });
    }
  }

  const widthHistogram = [...histogramByWidth.values()].sort((a, b) => a.halfWidth - b.halfWidth);

  // Adaptive threshold: walk the histogram from thickest to thinnest until the
  // "thick" classes cover a meaningful share of the drawing, then accept walls
  // slightly thinner than that class.
  let wallHalfWidthThreshold = options.wallHalfWidthThreshold ?? 0;
  if (!(wallHalfWidthThreshold > 0)) {
    const targetLength = options.wallCoverageFraction * totalStrokeLength;
    let cumulative = 0;
    let dominantThickWidth = 0;
    for (let i = widthHistogram.length - 1; i >= 0; i -= 1) {
      cumulative += widthHistogram[i].totalLength;
      if (cumulative >= targetLength) {
        dominantThickWidth = widthHistogram[i].halfWidth;
        break;
      }
    }
    wallHalfWidthThreshold = dominantThickWidth * options.wallWidthRatio;
  }

  // Second pass: collect wall subsegments (flattening quadratics into polylines).
  // Besides strokes at full wall thickness, long straight strokes at medium thickness
  // are accepted too: glass/curtain walls are often drawn thinner than solid walls but
  // much longer than furniture or door-arc pieces.
  const longWallMinLength = 0.01 * pageDiagonal;
  const longWallHalfWidthMin = 0.35 * wallHalfWidthThreshold;
  const walls: number[] = [];
  const acceptedWidthLengths: { halfWidth: number; length: number }[] = [];
  for (const i of eligible) {
    const base = i * 4;
    const halfWidth = styles[base];
    const x0 = endpoints[base];
    const y0 = endpoints[base + 1];
    const endX = primitiveMeta[base];
    const endY = primitiveMeta[base + 1];
    const primitiveType = primitiveMeta[base + 2];
    if (halfWidth < wallHalfWidthThreshold) {
      const isLongStraight =
        primitiveType === 0 && halfWidth >= longWallHalfWidthMin && Math.hypot(endX - x0, endY - y0) >= longWallMinLength;
      if (!isLongStraight) {
        continue;
      }
      walls.push(x0, y0, endX, endY, halfWidth);
      continue;
    }

    if (primitiveType === 1) {
      // Quadratic: endpoints[2..3] is the control point; flatten into 8 subsegments.
      const cx = endpoints[base + 2];
      const cy = endpoints[base + 3];
      let prevX = x0;
      let prevY = y0;
      const subdivisions = 8;
      for (let k = 1; k <= subdivisions; k += 1) {
        const t = k / subdivisions;
        const mt = 1 - t;
        const px = mt * mt * x0 + 2 * mt * t * cx + t * t * endX;
        const py = mt * mt * y0 + 2 * mt * t * cy + t * t * endY;
        walls.push(prevX, prevY, px, py, halfWidth);
        prevX = px;
        prevY = py;
      }
      acceptedWidthLengths.push({ halfWidth, length: Math.hypot(endX - x0, endY - y0) });
    } else {
      walls.push(x0, y0, endX, endY, halfWidth);
      acceptedWidthLengths.push({ halfWidth, length: Math.hypot(endX - x0, endY - y0) });
    }
  }

  return {
    walls: new Float64Array(walls),
    eligibleSegmentCount: eligible.length,
    totalStrokeLength,
    widthHistogram,
    wallHalfWidthThreshold,
    wallMedianHalfWidth: lengthWeightedMedianHalfWidth(acceptedWidthLengths)
  };
}

function lengthWeightedMedianHalfWidth(entries: { halfWidth: number; length: number }[]): number {
  if (entries.length === 0) {
    return 0;
  }
  const sorted = [...entries].sort((a, b) => a.halfWidth - b.halfWidth);
  let total = 0;
  for (const entry of sorted) {
    total += entry.length;
  }
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.length;
    if (cumulative >= total / 2) {
      return entry.halfWidth;
    }
  }
  return sorted[sorted.length - 1].halfWidth;
}

/** Sparse uniform grid over wall subsegments for radius-bounded proximity queries. */
class WallGrid {
  private readonly cells = new Map<number, number[]>();

  private readonly visited: Uint32Array;

  private visitStamp = 0;

  private readonly cols: number;

  constructor(
    private readonly walls: Float64Array,
    wallCount: number,
    private readonly minX: number,
    private readonly minY: number,
    maxX: number,
    maxY: number,
    private readonly cellSize: number
  ) {
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize) + 2);
    this.visited = new Uint32Array(wallCount);
    for (let i = 0; i < wallCount; i += 1) {
      const base = i * WALL_STRIDE;
      const x0 = walls[base];
      const y0 = walls[base + 1];
      const x1 = walls[base + 2];
      const y1 = walls[base + 3];
      const col0 = this.colOf(Math.min(x0, x1));
      const col1 = this.colOf(Math.max(x0, x1));
      const row0 = this.rowOf(Math.min(y0, y1));
      const row1 = this.rowOf(Math.max(y0, y1));
      for (let row = row0; row <= row1; row += 1) {
        for (let col = col0; col <= col1; col += 1) {
          const key = row * this.cols + col;
          const cell = this.cells.get(key);
          if (cell) {
            cell.push(i);
          } else {
            this.cells.set(key, [i]);
          }
        }
      }
    }
  }

  private colOf(x: number): number {
    return Math.max(0, Math.floor((x - this.minX) / this.cellSize) + 1);
  }

  private rowOf(y: number): number {
    return Math.max(0, Math.floor((y - this.minY) / this.cellSize) + 1);
  }

  /** Visit segments near a point; the visitor may return false to stop early. */
  forEachNear(x: number, y: number, radius: number, visitor: (wallIndex: number) => boolean | void): void {
    this.visitStamp += 1;
    const stamp = this.visitStamp;
    const col0 = this.colOf(x - radius);
    const col1 = this.colOf(x + radius);
    const row0 = this.rowOf(y - radius);
    const row1 = this.rowOf(y + radius);
    for (let row = row0; row <= row1; row += 1) {
      for (let col = col0; col <= col1; col += 1) {
        const cell = this.cells.get(row * this.cols + col);
        if (!cell) {
          continue;
        }
        for (const wallIndex of cell) {
          if (this.visited[wallIndex] === stamp) {
            continue;
          }
          this.visited[wallIndex] = stamp;
          if (visitor(wallIndex) === false) {
            return;
          }
        }
      }
    }
  }
}

function distanceToSegmentSquared(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((px - x0) * dx + (py - y0) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = x0 + dx * t;
  const cy = y0 + dy * t;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

interface WhiskerRaster {
  occupancy: Uint8Array;
  width: number;
  height: number;
  scale: number;
  worldToRasterX: (wx: number) => number;
  worldToRasterY: (wy: number) => number;
}

/**
 * Stage B: bridge door openings with "whiskers" — wall ends extended along their own
 * direction until they contact other wall material, capped at the door-gap limit.
 *
 * Floorplans usually cap wall ends at door jambs with a short perpendicular stroke, so a
 * wall end qualifies for extension when everything touching it is short (a jamb cap or a
 * dash piece); ends merging into long walls (corners, T-junctions) are left alone. The
 * gap is probed in the rasterized wall bitmap (cheap per-pixel marching); an extension
 * is only emitted when it actually reaches material on the far side, so ends facing
 * genuinely open space stay open.
 *
 * Returns closure segments as [x0, y0, x1, y1, halfWidth] runs.
 */
function buildWhiskerClosures(
  walls: Float64Array,
  wallCount: number,
  grid: WallGrid,
  wallWidth: number,
  maxWallHalfWidth: number,
  doorGapMax: number,
  raster: WhiskerRaster
): number[] {
  const closures: number[] = [];
  const localTouchPad = 0.25 * wallWidth;
  const capMaxLength = Math.max(5 * wallWidth, 0.5 * doorGapMax);
  // Collinear contacts (the wall continuing on the far side of the gap, e.g. window
  // sections) may be bridged across larger gaps than transversal contacts (door jambs),
  // which stay within the door-gap limit to avoid cutting corridors.
  const collinearGapMax = 2.5 * doorGapMax;
  const collinearAlignmentMin = Math.cos((15 * Math.PI) / 180);
  const { occupancy, width, height, scale } = raster;

  for (let i = 0; i < wallCount; i += 1) {
    const base = i * WALL_STRIDE;
    const ownHalfWidth = walls[base + 4];
    for (let end = 0; end < 2; end += 1) {
      const px = walls[base + end * 2];
      const py = walls[base + end * 2 + 1];
      const otherX = walls[base + (1 - end) * 2];
      const otherY = walls[base + (1 - end) * 2 + 1];
      const length = Math.hypot(px - otherX, py - otherY);
      if (!(length > 0)) {
        continue;
      }
      const dirX = (px - otherX) / length;
      const dirY = (py - otherY) / length;

      // A long segment touching this endpoint means the wall structure continues here
      // (corner, T-junction), so the end does not face an opening. Endpoints buried in
      // very dense geometry (hatches, symbols) are skipped outright — their whiskers
      // would be meaningless and the proximity scan would be expensive.
      let skipEndpoint = false;
      let examined = 0;
      grid.forEachNear(px, py, maxWallHalfWidth + ownHalfWidth + localTouchPad, (wallIndex) => {
        if (wallIndex === i) {
          return;
        }
        examined += 1;
        if (examined > 48) {
          skipEndpoint = true;
          return false;
        }
        const otherBase = wallIndex * WALL_STRIDE;
        const reach = ownHalfWidth + walls[otherBase + 4] + localTouchPad;
        const x0 = walls[otherBase];
        const y0 = walls[otherBase + 1];
        const x1 = walls[otherBase + 2];
        const y1 = walls[otherBase + 3];
        if (distanceToSegmentSquared(px, py, x0, y0, x1, y1) > reach * reach) {
          return;
        }
        if (Math.hypot(x1 - x0, y1 - y0) > capMaxLength) {
          skipEndpoint = true;
          return false;
        }
      });
      if (skipEndpoint) {
        continue;
      }

      // March along the ray in raster space: skip the initial occupied run (own stroke
      // cap, jamb cap), cross the free gap, and look for material on the far side.
      const rasterX = raster.worldToRasterX(px);
      const rasterY = raster.worldToRasterY(py);
      const rayDirX = dirX;
      const rayDirY = -dirY; // raster Y is flipped relative to world Y
      const initialRunLimitPx = (ownHalfWidth + 2.5 * maxWallHalfWidth) * scale + 3;
      const maxMarchPx = collinearGapMax * scale + initialRunLimitPx;
      let marchPx = 0;
      let freeRunStartPx = -1;
      let contactPx = -1;
      while (marchPx <= maxMarchPx) {
        const sampleX = Math.round(rasterX + rayDirX * marchPx);
        const sampleY = Math.round(rasterY + rayDirY * marchPx);
        if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) {
          break;
        }
        const occupied = occupancy[sampleY * width + sampleX] !== 0;
        if (freeRunStartPx < 0) {
          if (!occupied) {
            freeRunStartPx = marchPx;
          } else if (marchPx > initialRunLimitPx) {
            break; // buried in material, not facing a gap
          }
        } else if (occupied) {
          contactPx = marchPx;
          break;
        }
        marchPx += 1;
      }
      if (contactPx < 0 || freeRunStartPx < 0) {
        continue;
      }

      const gapWorld = (contactPx - freeRunStartPx) / scale;
      if (gapWorld > doorGapMax) {
        if (gapWorld > collinearGapMax) {
          continue;
        }
        // Allow long bridges only toward roughly collinear walls (window sections).
        const contactWorldX = px + dirX * (contactPx / scale);
        const contactWorldY = py + dirY * (contactPx / scale);
        let collinear = false;
        grid.forEachNear(contactWorldX, contactWorldY, maxWallHalfWidth + 2 / scale, (wallIndex) => {
          if (collinear || wallIndex === i) {
            return;
          }
          const otherBase = wallIndex * WALL_STRIDE;
          const x0 = walls[otherBase];
          const y0 = walls[otherBase + 1];
          const x1 = walls[otherBase + 2];
          const y1 = walls[otherBase + 3];
          const reach = walls[otherBase + 4] + 2.5 / scale;
          if (distanceToSegmentSquared(contactWorldX, contactWorldY, x0, y0, x1, y1) > reach * reach) {
            return;
          }
          const hitLength = Math.hypot(x1 - x0, y1 - y0);
          if (hitLength > 0 && Math.abs(((x1 - x0) * dirX + (y1 - y0) * dirY) / hitLength) >= collinearAlignmentMin) {
            collinear = true;
          }
        });
        if (!collinear) {
          continue;
        }
      }

      const extendWorld = (contactPx + 2) / scale;
      closures.push(px, py, px + dirX * extendWorld, py + dirY * extendWorld, ownHalfWidth);
    }
  }

  return closures;
}

/** Stamp a thick line segment (round caps) into the occupancy bitmap. */
function stampSegment(occupancy: Uint8Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number, radius: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  const step = Math.max(0.4, radius * 0.6);
  const steps = Math.max(1, Math.ceil(length / step));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    stampDisc(occupancy, width, height, x0 + dx * t, y0 + dy * t, radius);
  }
}

function stampDisc(occupancy: Uint8Array, width: number, height: number, cx: number, cy: number, radius: number): void {
  const minY = Math.max(0, Math.ceil(cy - radius));
  const maxY = Math.min(height - 1, Math.floor(cy + radius));
  for (let y = minY; y <= maxY; y += 1) {
    const dy = y - cy;
    const halfSpan = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    const minX = Math.max(0, Math.ceil(cx - halfSpan));
    const maxX = Math.min(width - 1, Math.floor(cx + halfSpan));
    if (minX <= maxX) {
      occupancy.fill(1, y * width + minX, y * width + maxX + 1);
    }
  }
}

/**
 * Morphological closing (dilate then erode) of the occupancy bitmap using a chamfer 3-4
 * distance transform, filling free-space gaps narrower than ~2x the radius.
 */
function morphologicalClose(occupancy: Uint8Array, width: number, height: number, radiusPx: number): void {
  if (!(radiusPx >= 1.5)) {
    return;
  }
  const limit = Math.round(radiusPx * 3);
  const infinity = 0x3fffffff;
  const distance = new Int32Array(width * height);

  // Distance to the nearest occupied pixel; threshold = dilation.
  for (let i = 0; i < distance.length; i += 1) {
    distance[i] = occupancy[i] !== 0 ? 0 : infinity;
  }
  chamferPass(distance, width, height);
  const dilated = new Uint8Array(width * height);
  for (let i = 0; i < distance.length; i += 1) {
    dilated[i] = distance[i] <= limit ? 1 : 0;
  }

  // Distance to the nearest non-dilated pixel; erosion keeps the deep interior.
  for (let i = 0; i < distance.length; i += 1) {
    distance[i] = dilated[i] === 0 ? 0 : infinity;
  }
  chamferPass(distance, width, height);
  for (let i = 0; i < distance.length; i += 1) {
    if (distance[i] > limit) {
      occupancy[i] = 1;
    }
  }
}

function chamferPass(distance: Int32Array, width: number, height: number): void {
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      let best = distance[index];
      if (best === 0) {
        continue;
      }
      if (x > 0 && distance[index - 1] + 3 < best) {
        best = distance[index - 1] + 3;
      }
      if (y > 0) {
        const up = index - width;
        if (distance[up] + 3 < best) {
          best = distance[up] + 3;
        }
        if (x > 0 && distance[up - 1] + 4 < best) {
          best = distance[up - 1] + 4;
        }
        if (x < width - 1 && distance[up + 1] + 4 < best) {
          best = distance[up + 1] + 4;
        }
      }
      distance[index] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = row + x;
      let best = distance[index];
      if (best === 0) {
        continue;
      }
      if (x < width - 1 && distance[index + 1] + 3 < best) {
        best = distance[index + 1] + 3;
      }
      if (y < height - 1) {
        const down = index + width;
        if (distance[down] + 3 < best) {
          best = distance[down] + 3;
        }
        if (x < width - 1 && distance[down + 1] + 4 < best) {
          best = distance[down + 1] + 4;
        }
        if (x > 0 && distance[down - 1] + 4 < best) {
          best = distance[down - 1] + 4;
        }
      }
      distance[index] = best;
    }
  }
}

/** Find a free pixel at/near the seed; returns a bitmap index or -1. May land in an existing region. */
function probeFreePixel(
  occupancy: Uint8Array,
  regionMap: Uint16Array,
  width: number,
  height: number,
  sx: number,
  sy: number,
  maxRadius: number
): number {
  const startIndex = sy * width + sx;
  if (occupancy[startIndex] === 0) {
    return startIndex;
  }
  let fallback = -1;
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const y = sy + dy;
      if (y < 0 || y >= height) {
        continue;
      }
      const stepX = Math.abs(dy) === radius ? 1 : 2 * radius;
      for (let dx = -radius; dx <= radius; dx += stepX) {
        const x = sx + dx;
        if (x < 0 || x >= width) {
          continue;
        }
        const index = y * width + x;
        if (occupancy[index] !== 0) {
          continue;
        }
        if (regionMap[index] === 0) {
          return index;
        }
        if (fallback < 0) {
          fallback = index;
        }
      }
    }
  }
  return fallback;
}

interface FloodFillResult {
  pixelCount: number;
  touchedBorder: boolean;
  aborted: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Scanline flood fill of free pixels (occupancy 0, region 0) writing `regionId`.
 * Touching the bitmap border or a pixel owned by `exteriorId` marks the region as
 * leaked (`touchedBorder`).
 */
function floodFillRegion(
  occupancy: Uint8Array,
  regionMap: Uint16Array,
  width: number,
  height: number,
  startIndex: number,
  regionId: number,
  maxPixels: number,
  exteriorId: number
): FloodFillResult {
  const result: FloodFillResult = {
    pixelCount: 0,
    touchedBorder: false,
    aborted: false,
    minX: width,
    minY: height,
    maxX: -1,
    maxY: -1
  };
  const stack: number[] = [startIndex];

  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (occupancy[index] !== 0 || regionMap[index] !== 0) {
      continue;
    }
    const y = Math.floor(index / width);
    const rowStart = y * width;
    let left = index;
    while (left > rowStart && occupancy[left - 1] === 0 && regionMap[left - 1] === 0) {
      left -= 1;
    }
    let right = index;
    const rowEnd = rowStart + width - 1;
    while (right < rowEnd && occupancy[right + 1] === 0 && regionMap[right + 1] === 0) {
      right += 1;
    }
    if ((left > rowStart && regionMap[left - 1] === exteriorId) || (right < rowEnd && regionMap[right + 1] === exteriorId)) {
      result.touchedBorder = true;
    }

    regionMap.fill(regionId, left, right + 1);
    const spanLength = right - left + 1;
    result.pixelCount += spanLength;

    const leftX = left - rowStart;
    const rightX = right - rowStart;
    if (leftX < result.minX) {
      result.minX = leftX;
    }
    if (rightX > result.maxX) {
      result.maxX = rightX;
    }
    if (y < result.minY) {
      result.minY = y;
    }
    if (y > result.maxY) {
      result.maxY = y;
    }
    if (leftX === 0 || rightX === width - 1 || y === 0 || y === height - 1) {
      result.touchedBorder = true;
    }
    if (result.pixelCount > maxPixels) {
      result.aborted = true;
      return result;
    }

    for (const otherRow of [y - 1, y + 1]) {
      if (otherRow < 0 || otherRow >= height) {
        continue;
      }
      const offset = (otherRow - y) * width;
      let x = left;
      while (x <= right) {
        if (occupancy[x + offset] === 0 && regionMap[x + offset] === 0) {
          stack.push(x + offset);
          while (x <= right && occupancy[x + offset] === 0 && regionMap[x + offset] === 0) {
            x += 1;
          }
        } else {
          if (regionMap[x + offset] === exteriorId) {
            result.touchedBorder = true;
          }
          x += 1;
        }
      }
    }
  }

  return result;
}

/**
 * Trace the outer contour of a region by walking pixel edges with the region kept on the
 * inside. Returns a closed polyline of grid-corner coordinates [x0, y0, x1, y1, ...].
 */
function traceRegionContour(
  regionMap: Uint16Array,
  width: number,
  height: number,
  regionId: number,
  bboxMinX: number,
  bboxMinY: number,
  bboxMaxX: number,
  bboxMaxY: number
): number[] {
  let startX = -1;
  let startY = -1;
  outer: for (let y = Math.max(0, bboxMinY); y <= Math.min(height - 1, bboxMaxY); y += 1) {
    const rowStart = y * width;
    for (let x = Math.max(0, bboxMinX); x <= Math.min(width - 1, bboxMaxX); x += 1) {
      if (regionMap[rowStart + x] === regionId) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  if (startX < 0) {
    return [];
  }

  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && regionMap[y * width + x] === regionId;

  // Directions: 0 = top edge (+x), 1 = right edge (+y), 2 = bottom edge (-x), 3 = left edge (-y).
  const points: number[] = [startX, startY];
  let px = startX;
  let py = startY;
  let dir = 0;
  let prevDir = 0;
  const maxSteps = 4 * (bboxMaxX - bboxMinX + 3) * (bboxMaxY - bboxMinY + 3) + 16;

  for (let step = 0; step < maxSteps; step += 1) {
    // End corner of the current edge.
    let cornerX: number;
    let cornerY: number;
    if (dir === 0) {
      cornerX = px + 1;
      cornerY = py;
    } else if (dir === 1) {
      cornerX = px + 1;
      cornerY = py + 1;
    } else if (dir === 2) {
      cornerX = px;
      cornerY = py + 1;
    } else {
      cornerX = px;
      cornerY = py;
    }

    // Decide the next edge: diagonal pixel first (outer turn), then straight, else inner turn.
    let nextPx = px;
    let nextPy = py;
    let nextDir: number;
    if (dir === 0) {
      if (inside(px + 1, py - 1)) {
        nextPx = px + 1;
        nextPy = py - 1;
        nextDir = 3;
      } else if (inside(px + 1, py)) {
        nextPx = px + 1;
        nextDir = 0;
      } else {
        nextDir = 1;
      }
    } else if (dir === 1) {
      if (inside(px + 1, py + 1)) {
        nextPx = px + 1;
        nextPy = py + 1;
        nextDir = 0;
      } else if (inside(px, py + 1)) {
        nextPy = py + 1;
        nextDir = 1;
      } else {
        nextDir = 2;
      }
    } else if (dir === 2) {
      if (inside(px - 1, py + 1)) {
        nextPx = px - 1;
        nextPy = py + 1;
        nextDir = 1;
      } else if (inside(px - 1, py)) {
        nextPx = px - 1;
        nextDir = 2;
      } else {
        nextDir = 3;
      }
    } else {
      if (inside(px - 1, py - 1)) {
        nextPx = px - 1;
        nextPy = py - 1;
        nextDir = 2;
      } else if (inside(px, py - 1)) {
        nextPy = py - 1;
        nextDir = 3;
      } else {
        nextDir = 0;
      }
    }

    if (nextDir !== prevDir) {
      points.push(cornerX, cornerY);
      prevDir = nextDir;
    } else {
      // Extend the previous emitted point along the same direction.
      points[points.length - 2] = cornerX;
      points[points.length - 1] = cornerY;
    }

    px = nextPx;
    py = nextPy;
    dir = nextDir;
    if (px === startX && py === startY && dir === 0) {
      break;
    }
  }

  // Drop a duplicated closing point if present.
  if (points.length >= 4 && points[0] === points[points.length - 2] && points[1] === points[points.length - 1]) {
    points.length -= 2;
  }
  return points;
}

/** Douglas-Peucker simplification of a closed polyline (flat [x, y, ...] coordinates). */
function simplifyClosedPolyline(points: number[], tolerance: number): number[] {
  const vertexCount = points.length / 2;
  if (vertexCount <= 4) {
    return [...points];
  }

  // Split the ring at vertex 0 and at the vertex farthest from it, then simplify both chains.
  let splitIndex = 1;
  let maxDistanceSquared = -1;
  for (let i = 1; i < vertexCount; i += 1) {
    const dx = points[i * 2] - points[0];
    const dy = points[i * 2 + 1] - points[1];
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > maxDistanceSquared) {
      maxDistanceSquared = distanceSquared;
      splitIndex = i;
    }
  }

  const keep = new Uint8Array(vertexCount);
  keep[0] = 1;
  keep[splitIndex] = 1;
  simplifyChain(points, 0, splitIndex, tolerance, keep);
  simplifyChainWrapped(points, splitIndex, vertexCount, tolerance, keep);

  const result: number[] = [];
  for (let i = 0; i < vertexCount; i += 1) {
    if (keep[i]) {
      result.push(points[i * 2], points[i * 2 + 1]);
    }
  }
  return result;
}

function simplifyChain(points: number[], startIndex: number, endIndex: number, tolerance: number, keep: Uint8Array): void {
  const stack: [number, number][] = [[startIndex, endIndex]];
  const toleranceSquared = tolerance * tolerance;
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    if (to - from < 2) {
      continue;
    }
    let worstIndex = -1;
    let worstDistanceSquared = toleranceSquared;
    const x0 = points[from * 2];
    const y0 = points[from * 2 + 1];
    const x1 = points[to * 2];
    const y1 = points[to * 2 + 1];
    for (let i = from + 1; i < to; i += 1) {
      const distanceSquared = distanceToSegmentSquared(points[i * 2], points[i * 2 + 1], x0, y0, x1, y1);
      if (distanceSquared > worstDistanceSquared) {
        worstDistanceSquared = distanceSquared;
        worstIndex = i;
      }
    }
    if (worstIndex >= 0) {
      keep[worstIndex] = 1;
      stack.push([from, worstIndex], [worstIndex, to]);
    }
  }
}

/** Simplify the chain from splitIndex around the ring back to vertex 0. */
function simplifyChainWrapped(points: number[], splitIndex: number, vertexCount: number, tolerance: number, keep: Uint8Array): void {
  const chainLength = vertexCount - splitIndex + 1;
  const chain: number[] = new Array(chainLength * 2);
  for (let i = 0; i < chainLength; i += 1) {
    const sourceIndex = (splitIndex + i) % vertexCount;
    chain[i * 2] = points[sourceIndex * 2];
    chain[i * 2 + 1] = points[sourceIndex * 2 + 1];
  }
  const chainKeep = new Uint8Array(chainLength);
  chainKeep[0] = 1;
  chainKeep[chainLength - 1] = 1;
  simplifyChain(chain, 0, chainLength - 1, tolerance, chainKeep);
  for (let i = 1; i < chainLength - 1; i += 1) {
    if (chainKeep[i]) {
      keep[(splitIndex + i) % vertexCount] = 1;
    }
  }
}

/** Snap near-horizontal/vertical edges to exact axis alignment and merge collinear runs. */
function snapAxisAlignedEdges(points: number[], axisSnapTan: number): number[] {
  const vertexCount = points.length / 2;
  if (vertexCount < 3) {
    return points;
  }
  const snapped = [...points];
  for (let i = 0; i < vertexCount; i += 1) {
    const j = (i + 1) % vertexCount;
    const dx = Math.abs(snapped[j * 2] - snapped[i * 2]);
    const dy = Math.abs(snapped[j * 2 + 1] - snapped[i * 2 + 1]);
    if (dx >= dy && dy <= dx * axisSnapTan) {
      const meanY = (snapped[i * 2 + 1] + snapped[j * 2 + 1]) / 2;
      snapped[i * 2 + 1] = meanY;
      snapped[j * 2 + 1] = meanY;
    } else if (dy > dx && dx <= dy * axisSnapTan) {
      const meanX = (snapped[i * 2] + snapped[j * 2]) / 2;
      snapped[i * 2] = meanX;
      snapped[j * 2] = meanX;
    }
  }

  // Drop degenerate vertices and merge collinear neighbors.
  const result: number[] = [];
  for (let i = 0; i < vertexCount; i += 1) {
    const prev = (i + vertexCount - 1) % vertexCount;
    const next = (i + 1) % vertexCount;
    const ax = snapped[i * 2] - snapped[prev * 2];
    const ay = snapped[i * 2 + 1] - snapped[prev * 2 + 1];
    const bx = snapped[next * 2] - snapped[i * 2];
    const by = snapped[next * 2 + 1] - snapped[i * 2 + 1];
    if (Math.hypot(bx, by) < 1e-6) {
      continue;
    }
    const cross = ax * by - ay * bx;
    const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (lengths > 0 && Math.abs(cross) / lengths < 1e-4 && ax * bx + ay * by > 0) {
      continue;
    }
    result.push(snapped[i * 2], snapped[i * 2 + 1]);
  }
  return result.length >= 6 ? result : snapped;
}

/**
 * Replace polygon edges with the inner face line of nearby parallel wall strokes, then
 * re-intersect adjacent edges to recover crisp corners.
 */
function snapPolygonToWallFaces(
  polygon: Float64Array,
  walls: Float64Array,
  grid: WallGrid,
  wallWidth: number,
  rasterErrorWorld: number
): Float64Array {
  const vertexCount = polygon.length / 2;
  if (vertexCount < 3) {
    return polygon;
  }
  const angleTolerance = Math.cos((6 * Math.PI) / 180);
  const queryRadius = wallWidth * 2.5;
  const maxVertexShift = wallWidth * 3;

  // Per edge: a supporting line as point (lx, ly) + unit direction (ldx, ldy).
  const lines = new Float64Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i += 1) {
    const j = (i + 1) % vertexCount;
    const x0 = polygon[i * 2];
    const y0 = polygon[i * 2 + 1];
    const x1 = polygon[j * 2];
    const y1 = polygon[j * 2 + 1];
    const edgeLength = Math.hypot(x1 - x0, y1 - y0);
    let lineX = x0;
    let lineY = y0;
    let lineDirX = edgeLength > 0 ? (x1 - x0) / edgeLength : 1;
    let lineDirY = edgeLength > 0 ? (y1 - y0) / edgeLength : 0;

    if (edgeLength > 0) {
      const midX = (x0 + x1) / 2;
      const midY = (y0 + y1) / 2;
      let bestScore = Number.POSITIVE_INFINITY;
      let bestWall = -1;
      let bestSide = 1;
      grid.forEachNear(midX, midY, queryRadius, (wallIndex) => {
        const base = wallIndex * WALL_STRIDE;
        const wx0 = walls[base];
        const wy0 = walls[base + 1];
        const wx1 = walls[base + 2];
        const wy1 = walls[base + 3];
        const wallHalfWidth = walls[base + 4];
        const wallLength = Math.hypot(wx1 - wx0, wy1 - wy0);
        if (!(wallLength > 0)) {
          return;
        }
        const wallDirX = (wx1 - wx0) / wallLength;
        const wallDirY = (wy1 - wy0) / wallLength;
        const alignment = Math.abs(wallDirX * lineDirX + wallDirY * lineDirY);
        if (alignment < angleTolerance) {
          return;
        }
        // Signed distance from the edge midpoint to the wall centerline.
        const offsetX = midX - wx0;
        const offsetY = midY - wy0;
        const along = offsetX * wallDirX + offsetY * wallDirY;
        if (along < -wallWidth || along > wallLength + wallWidth) {
          return;
        }
        const signedDistance = offsetX * -wallDirY + offsetY * wallDirX;
        const faceError = Math.abs(Math.abs(signedDistance) - wallHalfWidth);
        if (faceError > wallHalfWidth + rasterErrorWorld) {
          return;
        }
        if (faceError < bestScore) {
          bestScore = faceError;
          bestWall = wallIndex;
          bestSide = signedDistance >= 0 ? 1 : -1;
        }
      });

      if (bestWall >= 0) {
        const base = bestWall * WALL_STRIDE;
        const wx0 = walls[base];
        const wy0 = walls[base + 1];
        const wx1 = walls[base + 2];
        const wy1 = walls[base + 3];
        const wallHalfWidth = walls[base + 4];
        const wallLength = Math.hypot(wx1 - wx0, wy1 - wy0);
        const wallDirX = (wx1 - wx0) / wallLength;
        const wallDirY = (wy1 - wy0) / wallLength;
        // Offset the centerline by halfWidth toward the room side of the edge.
        lineX = wx0 + -wallDirY * bestSide * wallHalfWidth;
        lineY = wy0 + wallDirX * bestSide * wallHalfWidth;
        lineDirX = wallDirX;
        lineDirY = wallDirY;
      }
    }

    lines[i * 4] = lineX;
    lines[i * 4 + 1] = lineY;
    lines[i * 4 + 2] = lineDirX;
    lines[i * 4 + 3] = lineDirY;
  }

  const result = new Float64Array(polygon);
  for (let i = 0; i < vertexCount; i += 1) {
    const previousEdge = (i + vertexCount - 1) % vertexCount;
    const px = lines[previousEdge * 4];
    const py = lines[previousEdge * 4 + 1];
    const pdx = lines[previousEdge * 4 + 2];
    const pdy = lines[previousEdge * 4 + 3];
    const cx = lines[i * 4];
    const cy = lines[i * 4 + 1];
    const cdx = lines[i * 4 + 2];
    const cdy = lines[i * 4 + 3];
    const cross = pdx * cdy - pdy * cdx;
    if (Math.abs(cross) < 1e-9) {
      continue;
    }
    const t = ((cx - px) * cdy - (cy - py) * cdx) / cross;
    const ix = px + pdx * t;
    const iy = py + pdy * t;
    if (Math.hypot(ix - polygon[i * 2], iy - polygon[i * 2 + 1]) <= maxVertexShift) {
      result[i * 2] = ix;
      result[i * 2 + 1] = iy;
    }
  }
  return result;
}

function polygonCentroid(polygon: ArrayLike<number>): { x: number; y: number } {
  const vertexCount = polygon.length / 2;
  let doubleArea = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let i = 0; i < vertexCount; i += 1) {
    const j = (i + 1) % vertexCount;
    const cross = polygon[i * 2] * polygon[j * 2 + 1] - polygon[j * 2] * polygon[i * 2 + 1];
    doubleArea += cross;
    centroidX += (polygon[i * 2] + polygon[j * 2]) * cross;
    centroidY += (polygon[i * 2 + 1] + polygon[j * 2 + 1]) * cross;
  }
  if (Math.abs(doubleArea) < 1e-12) {
    let meanX = 0;
    let meanY = 0;
    for (let i = 0; i < vertexCount; i += 1) {
      meanX += polygon[i * 2];
      meanY += polygon[i * 2 + 1];
    }
    return { x: meanX / vertexCount, y: meanY / vertexCount };
  }
  return { x: centroidX / (3 * doubleArea), y: centroidY / (3 * doubleArea) };
}

function signedPolygonArea(polygon: ArrayLike<number>): number {
  const vertexCount = polygon.length / 2;
  let doubleArea = 0;
  for (let i = 0; i < vertexCount; i += 1) {
    const j = (i + 1) % vertexCount;
    doubleArea += polygon[i * 2] * polygon[j * 2 + 1] - polygon[j * 2] * polygon[i * 2 + 1];
  }
  return doubleArea / 2;
}

function reversePolygon(polygon: Float64Array): Float64Array {
  const vertexCount = polygon.length / 2;
  const reversed = new Float64Array(polygon.length);
  for (let i = 0; i < vertexCount; i += 1) {
    const sourceIndex = vertexCount - 1 - i;
    reversed[i * 2] = polygon[sourceIndex * 2];
    reversed[i * 2 + 1] = polygon[sourceIndex * 2 + 1];
  }
  return reversed;
}

function rangeArray(count: number): number[] {
  const result: number[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    result[i] = i;
  }
  return result;
}

function normalizePositive(value: number | undefined, fallback: number): number;
function normalizePositive(value: number | undefined, fallback: null): number | null;
function normalizePositive(value: number | undefined, fallback: number | null): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
