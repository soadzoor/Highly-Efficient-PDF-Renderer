import {
  decodeStrokeStyleMeta,
  STROKE_STYLE_FLAG_HAIRLINE,
  type PageTextIndex,
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
   * Lower clamp of the bridged door gap, as a fraction of the page diagonal. Matters for
   * drawings whose wall strokes are hairline-thin: door openings still have
   * architectural proportions regardless of stroke width.
   *
   * @default 0.0055
   */
  doorGapFloorFactor?: number;

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
   * Regions smaller than this many raster pixels are discarded as noise. The default
   * (~28x28 px at the default 4096 raster, roughly 1.5 x 1.5 m on a typical floorplan)
   * is below any real room but above label frames and fixture pockets.
   *
   * @default 800
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

  /**
   * Require every room to touch at least one bridged opening (door). A region that is
   * completely sealed by drawn strokes cannot be entered, so it is treated as furniture,
   * a label frame, a column, or a wall cavity rather than a room.
   *
   * @default true
   */
  requireDoor?: boolean;

  /**
   * Drop wall candidates whose connected stroke cluster is small and isolated from the
   * wall network (equipment symbols, letters drawn as paths, label frames). Expressed as
   * a multiple of the resolved door-gap limit: clusters spanning less than this many
   * door widths are discarded. Set to 0 to disable.
   *
   * @default 2.5
   */
  minWallComponentFactor?: number;

  /**
   * Split one detected region between distant room-label clusters, e.g. a continuous
   * corridor carrying several CORRIDOR labels becomes one room per label.
   *
   * @default true
   */
  splitByLabels?: boolean;

  /**
   * Also split oversized regions that carry no label seeds, along wall-stub pinch
   * lines, growing from virtual seeds at the centers of their open pockets. Raises
   * recall on drawings whose text is inaccessible (drawn as paths) at the cost of
   * extra false-positive room fragments.
   *
   * @default false
   */
  splitUnlabeledRegions?: boolean;

  /**
   * Long straight strokes are accepted as walls when their half-width is at least this
   * fraction of the wall threshold (glass/curtain walls are drawn thinner than solid
   * walls). Set to 0 to accept long straight strokes of any width.
   *
   * @default 0.35
   */
  longWallHalfWidthMinFactor?: number;

  /**
   * Outward offset applied to final room polygons, as a fraction of the page diagonal.
   * Rasterized contours run along the edges of the stamped walls and lose roughly one
   * raster pixel of room area all around; the default recovers it. Set to 0 to disable.
   *
   * @default 0.0003
   */
  boundaryOffsetFactor?: number;

  /**
   * Wall candidate selection strategy. `"strokeWidth"` classifies by the stroke-width
   * distribution (default). `"doubleLine"` detects walls drawn as pairs of long parallel
   * thin lines (the two wall faces) and stamps the cavity between them — useful for CAD
   * exports where every stroke has the same width and furniture is indistinguishable
   * from walls by width alone. When the adaptive threshold is used, `detectRooms` also
   * tries this mode automatically as an alternate hypothesis on uniform-width pages.
   *
   * @default "strokeWidth"
   */
  wallDetectionMode?: "strokeWidth" | "doubleLine";

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
  /**
   * Best room-number candidate among the room's labels: a token carrying digits,
   * most often a few digits followed by one or two letters ("1324A", "1564C").
   * Empty when no label looks like a room number (name-only labels such as
   * "LOCKERS" describe the room type, not its number).
   */
  roomNumber: string;
  /**
   * Heuristic room-likeness in [0, 1], from the room's proportions (mean thickness
   * relative to door openings, bounding-box fill) and its labels (room-like label
   * present, any label present). Useful for ranking rooms in review flows; not a
   * calibrated probability.
   */
  confidence: number;
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
  | "noWalls"
  | "noDoor"
  | "wallCavity";

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
  /** True when stroke widths carried no signal and ink-density filtering was the fallback. */
  uniformWidthMode: boolean;
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
  /**
   * Where the flood-fill seeds came from: caller-provided, `scene.textContent`
   * (PDF sources with `extractTextContent`), the scene's searchable text index
   * (parsed-zip sources), or nothing (only unlabeled rooms are detected).
   */
  seedSource: "textContent" | "textIndex" | "provided" | "none";
  debug?: RoomDetectionDebugInfo;
}

interface ResolvedOptions {
  wallHalfWidthThreshold: number | null;
  wallCoverageFraction: number;
  wallWidthRatio: number;
  /** Long straight strokes at least this fraction of the wall threshold count as walls. */
  longWallHalfWidthMinFactor: number;
  /** How wall candidates are selected: by stroke width statistics, or by pairing long parallel stroke chains (double-line walls). */
  wallDetectionMode: "strokeWidth" | "doubleLine";
  doorGapFactor: number;
  /** Lower clamp of the bridged door gap, as a fraction of the page diagonal. */
  doorGapFloorFactor: number;
  /** Outward offset applied to final room polygons, as a fraction of the page diagonal. */
  boundaryOffsetFactor: number;
  /** Double-line mode only: also stamp density-filtered raw stroke ink under the paired walls. */
  stampDensityInk: boolean;
  /** Split oversized label-less regions along wall stubs using virtual clearance-maxima seeds. */
  splitUnlabeledRegions: boolean;
  maxRasterSize: number;
  maxRoomAreaFraction: number;
  minRoomAreaPixels: number;
  simplifyTolerancePx: number;
  axisSnapAngleDegrees: number;
  snapToWallLines: boolean;
  detectUnlabeledRooms: boolean;
  requireDoor: boolean;
  minWallComponentFactor: number;
  splitByLabels: boolean;
  allowDensityFilter: boolean;
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
 * Seeds default to `scene.textContent` (PDF sources with text extraction enabled via
 * `extractText` / `extractTextContent`); scenes without it fall back to word-level items
 * derived from the searchable text index (`scene.textIndex`), which parsed-zip sources
 * carry. Without either, only unlabeled rooms are detected.
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
    longWallHalfWidthMinFactor:
      options.longWallHalfWidthMinFactor !== undefined &&
      Number.isFinite(options.longWallHalfWidthMinFactor) &&
      options.longWallHalfWidthMinFactor >= 0
        ? options.longWallHalfWidthMinFactor
        : 0.35,
    wallDetectionMode: options.wallDetectionMode === "doubleLine" ? "doubleLine" : "strokeWidth",
    doorGapFactor: normalizePositive(options.doorGapFactor, 12),
    doorGapFloorFactor: normalizePositive(options.doorGapFloorFactor, 0.0055),
    boundaryOffsetFactor:
      options.boundaryOffsetFactor !== undefined &&
      Number.isFinite(options.boundaryOffsetFactor) &&
      options.boundaryOffsetFactor >= 0
        ? options.boundaryOffsetFactor
        : 0.0003,
    maxRasterSize: Math.max(256, Math.trunc(normalizePositive(options.maxRasterSize, 4096))),
    maxRoomAreaFraction: normalizePositive(options.maxRoomAreaFraction, 0.35),
    minRoomAreaPixels: Math.max(1, Math.trunc(normalizePositive(options.minRoomAreaPixels, 800))),
    simplifyTolerancePx: normalizePositive(options.simplifyTolerancePx, 1.5),
    axisSnapAngleDegrees: normalizePositive(options.axisSnapAngleDegrees, 4),
    snapToWallLines: options.snapToWallLines !== false,
    detectUnlabeledRooms: options.detectUnlabeledRooms !== false,
    requireDoor: options.requireDoor !== false,
    minWallComponentFactor:
      options.minWallComponentFactor !== undefined && Number.isFinite(options.minWallComponentFactor) && options.minWallComponentFactor >= 0
        ? options.minWallComponentFactor
        : 2.5,
    splitByLabels: options.splitByLabels !== false,
    splitUnlabeledRegions: options.splitUnlabeledRegions === true,
    allowDensityFilter: true,
    stampDensityInk: false
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
      : scene.textIndex?.pages.some((page) => page.text.length > 0)
        ? "textIndex"
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
    stats: RoomDetectionPageStats | null;
    debug: RoomDetectionDebugInfo | undefined;
    debugWalls: number[];
    debugClosures: number[];
  }

  const runPage = (pageIndex: number, pageOptions: ResolvedOptions): PageAttempt => {
    const attempt: PageAttempt = {
      rooms: [],
      failedSeeds: [],
      stats: null,
      debug: collectDebug
        ? { wallSegments: new Float32Array(0), virtualClosures: new Float32Array(0), rawContours: [], pageStats: new Map(), regionDebug: new Map() }
        : undefined,
      debugWalls: [],
      debugClosures: []
    };
    attempt.stats = detectRoomsOnPage(scene, pageIndex, pageOptions, providedSeeds, attempt.rooms, attempt.failedSeeds, attempt.debug, attempt.debugWalls, attempt.debugClosures);
    return attempt;
  };

  // Seeds that landed inside an accepted room. Invariant to how regions are split or
  // merged (unlike counting labeled rooms, which rewards fragmentation).
  const explainedSeeds = (attempt: PageAttempt): number => attempt.rooms.reduce((count, room) => count + room.labels.length, 0);

  // Label-free attempt quality: area-weighted rectangularity of the detected rooms.
  // Correctly carved rooms are mostly rectangular (area close to their bounding box);
  // furniture fragmentation produces jagged low-rectangularity pockets, and unbridged
  // door openings merge rooms into sprawling low-rectangularity blobs, so both failure
  // modes score low while clean partitions score high.
  const geometricScore = (attempt: PageAttempt, minPlausibleArea: number): number => {
    let score = 0;
    for (const room of attempt.rooms) {
      if (!(room.area >= minPlausibleArea)) {
        continue;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const polygon = room.polygon;
      for (let i = 0; i + 1 < polygon.length; i += 2) {
        minX = Math.min(minX, polygon[i]);
        maxX = Math.max(maxX, polygon[i]);
        minY = Math.min(minY, polygon[i + 1]);
        maxY = Math.max(maxY, polygon[i + 1]);
      }
      const bboxArea = Math.max(1e-9, (maxX - minX) * (maxY - minY));
      const rectangularity = Math.min(1, room.area / bboxArea);
      score += room.area * rectangularity * rectangularity;
    }
    return score;
  };

  for (const pageIndex of pageIndexes) {
    let attempt = runPage(pageIndex, resolved);

    // The wall classifier can pick the wrong strokes (wrong width class, or the
    // ink-density fallback erased single-line walls). When the first attempt relied on
    // density filtering, a large share of label seeds leaked, or the page carries no
    // label seeds at all (CAD exports with text drawn as paths), try alternate wall
    // hypotheses and keep the best attempt. Pages with labels are judged by how many
    // labels they explain (fewer leaks, then geometry as tiebreaks); label-less pages
    // are judged by the geometric quality score alone.
    if (resolved.wallHalfWidthThreshold === null) {
      const rectBase = pageIndex * 4;
      const pageWidth = Math.abs(scene.pageRects[rectBase + 2] - scene.pageRects[rectBase]);
      const pageHeight = Math.abs(scene.pageRects[rectBase + 3] - scene.pageRects[rectBase + 1]);
      const pageDiagonal = Math.hypot(pageWidth, pageHeight);
      const minPlausibleArea = (0.011 * pageDiagonal) ** 2;

      const labelSeedCount = attempt.rooms.reduce((count, room) => count + room.labels.length, 0) + attempt.failedSeeds.length;
      const leakedCount = (candidate: PageAttempt): number =>
        candidate.failedSeeds.filter((failure) => failure.reason === "leaked" || failure.reason === "noWalls").length;
      const firstWasUniform = attempt.stats?.uniformWidthMode === true;
      const massLeak = labelSeedCount >= 10 && leakedCount(attempt) / labelSeedCount > 0.45;
      const hasLabels = labelSeedCount >= 10;

      if (firstWasUniform || massLeak || !hasLabels) {
        const candidates: PageAttempt[] = [runPage(pageIndex, { ...resolved, wallHalfWidthThreshold: 1e-9, allowDensityFilter: false })];
        if (!firstWasUniform) {
          candidates.push(runPage(pageIndex, { ...resolved, wallHalfWidthThreshold: 1e-9, allowDensityFilter: true }));
          // Thick walls plus long straight strokes of any width: catches plans whose
          // partition/glass walls are drawn thin while furniture stays short-stroked.
          candidates.push(runPage(pageIndex, { ...resolved, longWallHalfWidthMinFactor: 0 }));
        }
        // Walls as pairs of parallel thin lines: the width-blind hypothesis for CAD
        // exports where furniture and walls share one stroke class. (The hybrid
        // stampDensityInk variant is not auto-tried: the geometric score misranks it
        // on dashed-line plans; reachable via options for manual tuning.)
        if (resolved.wallDetectionMode !== "doubleLine") {
          candidates.push(runPage(pageIndex, { ...resolved, wallDetectionMode: "doubleLine", allowDensityFilter: false }));
        }
        for (const candidate of candidates) {
          let better: boolean;
          if (hasLabels) {
            // Clearly more seeds explained wins; within a small margin fall back to
            // fewer leaks, then geometric quality (which penalizes fragmentation).
            const candidateSeeds = explainedSeeds(candidate);
            const attemptSeeds = explainedSeeds(attempt);
            if (candidateSeeds > attemptSeeds * 1.02) {
              better = true;
            } else if (candidateSeeds >= attemptSeeds * 0.98) {
              const leakDelta = leakedCount(candidate) - leakedCount(attempt);
              better =
                leakDelta < 0 ||
                (leakDelta === 0 && geometricScore(candidate, minPlausibleArea) > geometricScore(attempt, minPlausibleArea));
            } else {
              better = false;
            }
          } else {
            better = geometricScore(candidate, minPlausibleArea) > geometricScore(attempt, minPlausibleArea);
          }
          if (better) {
            attempt = candidate;
          }
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
): RoomDetectionPageStats | null {
  const rectOffset = pageIndex * 4;
  const pageMinX = scene.pageRects[rectOffset];
  const pageMinY = scene.pageRects[rectOffset + 1];
  const pageMaxX = scene.pageRects[rectOffset + 2];
  const pageMaxY = scene.pageRects[rectOffset + 3];
  const pageWidth = pageMaxX - pageMinX;
  const pageHeight = pageMaxY - pageMinY;
  if (!(pageWidth > 0) || !(pageHeight > 0)) {
    return null;
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
    uniformWidthMode: stageA.uniformWidthMode,
    doorGapMax: 0,
    closureCount: 0,
    rasterScale: 0,
    rasterWidth: 0,
    rasterHeight: 0,
    seedCount: seeds.length
  };
  debug?.pageStats.set(pageIndex, stats);

  const initialWallCount = stageA.walls.length / WALL_STRIDE;
  if (initialWallCount === 0 || !(stageA.wallMedianHalfWidth > 0)) {
    for (const seed of seeds) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: "noWalls" });
    }
    return stats;
  }

  // Resolved gap thresholds. The page-diagonal floor matters for drawings whose wall
  // strokes are hairline-thin: door openings still have architectural proportions.
  // Double-line walls report their true architectural width (the cavity), so the large
  // multiplier calibrated for understated stroke widths would overshoot doors wildly
  // there; doors are ~4.5 wall-widths and page-proportioned.
  const wallWidth = stageA.wallMedianHalfWidth * 2;
  const doorGapMax =
    options.wallDetectionMode === "doubleLine"
      ? Math.min(
        Math.max(4.5 * wallWidth, options.doorGapFloorFactor * pageDiagonal),
        0.012 * pageDiagonal
      )
      : Math.min(
        Math.max(options.doorGapFactor * wallWidth, options.doorGapFloorFactor * pageDiagonal),
        0.025 * pageDiagonal
      );

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

  // Hybrid double-line mode: put density-filtered raw stroke ink underneath the paired
  // walls. The pairs carry the definitive structure (and are stamped after the filter,
  // so it cannot erase them); the dense ink adds partitions the pairing missed.
  if (options.stampDensityInk && stageA.rawSegments) {
    const raw = stageA.rawSegments;
    for (let i = 0; i + 3 < raw.length; i += 4) {
      stampSegment(
        occupancy,
        rasterWidth,
        rasterHeight,
        worldToRasterX(raw[i]),
        worldToRasterY(raw[i + 1]),
        worldToRasterX(raw[i + 2]),
        worldToRasterY(raw[i + 3]),
        0.875
      );
    }
    filterOccupancyByDensity(occupancy, rasterWidth, rasterHeight, 3, 0.45);
  }

  for (let i = 0; i < initialWallCount; i += 1) {
    const base = i * WALL_STRIDE;
    stampSegment(
      occupancy,
      rasterWidth,
      rasterHeight,
      worldToRasterX(stageA.walls[base]),
      worldToRasterY(stageA.walls[base + 1]),
      worldToRasterX(stageA.walls[base + 2]),
      worldToRasterY(stageA.walls[base + 3]),
      Math.max(stageA.walls[base + 4] * scale, 0.875)
    );
  }

  // When stroke width carried no signal, fall back to ink density: walls are drawn as
  // bands (double faces, hatching) that ink a wide footprint, while furniture, door
  // leaves, and annotation are sparse single lines. Long straight runs (glazing,
  // single-line partitions) are sparse but real, so they are stamped back afterwards.
  if (stageA.uniformWidthMode && options.allowDensityFilter && options.wallDetectionMode !== "doubleLine") {
    filterOccupancyByDensity(occupancy, rasterWidth, rasterHeight, 3, 0.45);
    const longKeepLength = 0.01 * pageDiagonal;
    for (let i = 0; i < initialWallCount; i += 1) {
      const base = i * WALL_STRIDE;
      const length = Math.hypot(stageA.walls[base + 2] - stageA.walls[base], stageA.walls[base + 3] - stageA.walls[base + 1]);
      if (length >= longKeepLength) {
        stampSegment(
          occupancy,
          rasterWidth,
          rasterHeight,
          worldToRasterX(stageA.walls[base]),
          worldToRasterY(stageA.walls[base + 1]),
          worldToRasterX(stageA.walls[base + 2]),
          worldToRasterY(stageA.walls[base + 3]),
          Math.max(stageA.walls[base + 4] * scale, 0.875)
        );
      }
    }
  }

  // Drop small isolated stroke clusters (equipment symbols, letters drawn as paths,
  // label frames): real walls form a large connected network, optionally via doors.
  const walls =
    options.minWallComponentFactor > 0
      ? pruneIsolatedWallComponents(
        occupancy,
        rasterWidth,
        rasterHeight,
        stageA.walls,
        worldToRasterX,
        worldToRasterY,
        options.minWallComponentFactor * doorGapMax * scale
      )
      : stageA.walls;
  const wallCount = walls.length / WALL_STRIDE;
  stats.wallSegmentCount = wallCount;
  if (wallCount === 0) {
    for (const seed of seeds) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: "noWalls" });
    }
    return stats;
  }

  if (debug) {
    for (let i = 0; i < wallCount; i += 1) {
      const base = i * WALL_STRIDE;
      debugWallSegments.push(walls[base], walls[base + 1], walls[base + 2], walls[base + 3]);
    }
  }

  let maxWallHalfWidth = 0;
  for (let i = 0; i < wallCount; i += 1) {
    maxWallHalfWidth = Math.max(maxWallHalfWidth, walls[i * WALL_STRIDE + 4]);
  }
  const grid = new WallGrid(walls, wallCount, pageMinX, pageMinY, pageMaxX, pageMaxY, Math.max(doorGapMax, wallWidth * 4));

  // Stage B: bridge door openings by extending wall ends until they contact other walls.
  // Closures are tracked in their own mask as well: a room must touch one of them to
  // count as a room at all (a fully sealed shape has no door). Door-swing arcs are
  // literal doors: they seal the doorway in the occupancy AND mark it as an opening.
  const closureMask = new Uint8Array(rasterWidth * rasterHeight);
  for (const target of [occupancy, closureMask]) {
    for (let i = 0; i + 4 < stageA.doorArcs.length + 1; i += WALL_STRIDE) {
      stampSegment(
        target,
        rasterWidth,
        rasterHeight,
        worldToRasterX(stageA.doorArcs[i]),
        worldToRasterY(stageA.doorArcs[i + 1]),
        worldToRasterX(stageA.doorArcs[i + 2]),
        worldToRasterY(stageA.doorArcs[i + 3]),
        Math.max(stageA.doorArcs[i + 4] * scale, 0.875)
      );
    }
  }
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
  for (const target of [occupancy, closureMask]) {
    for (let i = 0; i + 4 < closures.length + 1; i += WALL_STRIDE) {
      stampSegment(
        target,
        rasterWidth,
        rasterHeight,
        worldToRasterX(closures[i]),
        worldToRasterY(closures[i + 1]),
        worldToRasterX(closures[i + 2]),
        worldToRasterY(closures[i + 3]),
        Math.max(closures[i + 4] * scale, 0.875)
      );
    }
  }

  // Close small gaps: walls drawn as two parallel face strokes leave a hollow band that
  // would otherwise be detected as a snaking enclosed region, and dashed wall pieces
  // leave pinholes. When the face-pair spacing was measured, the radius is sized to fill
  // exactly that band; either way it stays well below door-opening widths.
  morphologicalClose(
    occupancy,
    rasterWidth,
    rasterHeight,
    Math.min(Math.max(1.5 * wallWidth * scale, 2.5), 0.35 * doorGapMax * scale, 12)
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
    touchesDoor: boolean;
    pixelCount: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    seeds: PageSeed[];
    seedProbes: number[];
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
        region.seedProbes.push(probe);
      }
      continue;
    }

    if (nextRegionId >= EXTERIOR_REGION_ID) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: "tooLarge" });
      continue;
    }
    const regionId = nextRegionId;
    nextRegionId += 1;
    const fill = floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, probe, regionId, maxRegionPixels, EXTERIOR_REGION_ID, closureMask);
    const region: RegionRecord = {
      failure: null,
      roomIndex: -1,
      auto: false,
      touchesDoor: fill.touchedDoor,
      pixelCount: fill.pixelCount,
      minX: fill.minX,
      minY: fill.minY,
      maxX: fill.maxX,
      maxY: fill.maxY,
      seeds: [seed],
      seedProbes: [probe]
    };
    regions.push(region);

    if (fill.aborted) {
      region.failure = "tooLarge";
    } else if (fill.touchedBorder) {
      region.failure = "leaked";
    } else if (fill.pixelCount < options.minRoomAreaPixels) {
      region.failure = "tooSmall";
    } else if (options.requireDoor && !fill.touchedDoor) {
      // Sealed shapes are usually furniture or label frames — but a room-number label
      // inside a region much larger than the label itself is strong evidence of a real
      // (door-less in the drawing) room, e.g. a shaft or riser.
      const item = seed.item;
      const labelAreaPx = item ? Math.max(1, (item.maxX - item.minX) * (item.maxY - item.minY) * scale * scale) : 1;
      const labelOverridesDoor = item !== null && isRoomLikeLabel(seed.label) && fill.pixelCount >= 6 * labelAreaPx;
      if (!labelOverridesDoor) {
        region.failure = "noDoor";
      }
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
        const fill = floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, index, regionId, maxRegionPixels, EXTERIOR_REGION_ID, closureMask);
        regions.push({
          failure: fill.aborted
            ? "tooLarge"
            : fill.touchedBorder
              ? "leaked"
              : fill.pixelCount < autoMinAreaPixels
                ? "tooSmall"
                : options.requireDoor && !fill.touchedDoor
                  ? "noDoor"
                  : null,
          roomIndex: -1,
          auto: true,
          touchesDoor: fill.touchedDoor,
          pixelCount: fill.pixelCount,
          minX: fill.minX,
          minY: fill.minY,
          maxX: fill.maxX,
          maxY: fill.maxY,
          seeds: [],
          seedProbes: []
        });
      }
    }
  }

  // Split regions that carry several distant room-label clusters (e.g. one continuous
  // corridor with multiple CORRIDOR labels, or an open floor zoned by labels) along the
  // equidistance between the clusters. Stacked multi-line labels stay one cluster, and
  // clusters made only of annotation-like text (GFI, +45", J) never cause a split.
  let clearance: Int32Array | null = null;

  if (options.splitByLabels) {
    const originalRegionCount = regions.length;
    for (let regionIndex = 0; regionIndex < originalRegionCount; regionIndex += 1) {
      const region = regions[regionIndex];
      if (region.failure || region.seeds.length < 2) {
        continue;
      }
      const clusters = clusterLabelSeeds(region.seeds, region.seedProbes);
      const roomClusters = clusters.filter((cluster) => cluster.roomLike);
      if (roomClusters.length < 2 || nextRegionId + roomClusters.length > EXTERIOR_REGION_ID) {
        continue;
      }
      clearance ??= buildClearanceField(occupancy, rasterWidth, rasterHeight);
      // Annotation-only clusters join their nearest room-label cluster.
      for (const cluster of clusters) {
        if (cluster.roomLike) {
          continue;
        }
        let best = roomClusters[0];
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const candidate of roomClusters) {
          const distance = Math.hypot(candidate.x - cluster.x, candidate.y - cluster.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        }
        best.seeds.push(...cluster.seeds);
        best.probes.push(...cluster.probes);
      }

      const newIds = roomClusters.map(() => {
        const id = nextRegionId;
        nextRegionId += 1;
        return id;
      });
      const { fills, frontiers } = watershedSplitRegion(regionMap, clearance, rasterWidth, rasterHeight, regionIndex + 1, roomClusters, newIds);

      // Frontiers settle on low-clearance pinch lines between wall stubs, so a split is
      // meaningful when its frontier stays pinch-scale. Merge sub-regions back when the
      // widest passage on the frontier is hall-scale (clearance beyond ~3 door gaps: the
      // labels share one continuous open space) or the total frontier is very long.
      const frontierMaxPx = 3 * doorGapMax * scale;
      const frontierClearanceMax = 4.5 * doorGapMax * scale; // chamfer units: 3 per px
      const groupOf = new Int32Array(roomClusters.length);
      for (let clusterIndex = 0; clusterIndex < roomClusters.length; clusterIndex += 1) {
        groupOf[clusterIndex] = clusterIndex;
      }
      const findGroup = (clusterIndex: number): number => {
        let root = clusterIndex;
        while (groupOf[root] !== root) {
          root = groupOf[root];
        }
        return root;
      };
      for (const [key, frontier] of frontiers) {
        if (frontier.maxClearance > frontierClearanceMax || frontier.lengthPx > frontierMaxPx) {
          const a = findGroup(Math.floor(key / 4096));
          const b = findGroup(key % 4096);
          if (a !== b) {
            groupOf[a] = b;
          }
        }
      }

      // Canonical cluster per group, and the pixel repaint target for each new id.
      const canonicalOf = new Map<number, number>();
      let groupCount = 0;
      for (let clusterIndex = 0; clusterIndex < roomClusters.length; clusterIndex += 1) {
        const root = findGroup(clusterIndex);
        if (!canonicalOf.has(root)) {
          canonicalOf.set(root, clusterIndex);
          groupCount += 1;
        }
      }

      const repaint = new Map<number, number>();
      if (groupCount <= 1) {
        // Everything merged back: restore the parent region untouched.
        for (const id of newIds) {
          repaint.set(id, regionIndex + 1);
        }
      } else {
        for (let clusterIndex = 0; clusterIndex < roomClusters.length; clusterIndex += 1) {
          repaint.set(newIds[clusterIndex], newIds[canonicalOf.get(findGroup(clusterIndex)) as number]);
        }
      }
      let needsRepaint = false;
      for (const [from, to] of repaint) {
        if (from !== to) {
          needsRepaint = true;
        }
      }
      if (needsRepaint) {
        const repaintMinX = Math.max(0, region.minX);
        const repaintMaxX = Math.min(rasterWidth - 1, region.maxX);
        for (let y = Math.max(0, region.minY); y <= Math.min(rasterHeight - 1, region.maxY); y += 1) {
          const rowBase = y * rasterWidth;
          for (let x = repaintMinX; x <= repaintMaxX; x += 1) {
            const target = repaint.get(regionMap[rowBase + x]);
            if (target !== undefined) {
              regionMap[rowBase + x] = target;
            }
          }
        }
      }

      if (groupCount <= 1) {
        // Parent stays a single room; the allocated ids are repainted away but still
        // need placeholder records so region ids keep matching array indexes.
        for (let k = 0; k < newIds.length; k += 1) {
          regions.push({
            failure: "duplicate",
            roomIndex: -1,
            auto: false,
            touchesDoor: region.touchesDoor,
            pixelCount: 0,
            minX: 0,
            minY: 0,
            maxX: -1,
            maxY: -1,
            seeds: [],
            seedProbes: []
          });
        }
        continue;
      }

      region.failure = "duplicate"; // parent retired in favor of its splits
      for (let clusterIndex = 0; clusterIndex < roomClusters.length; clusterIndex += 1) {
        const root = findGroup(clusterIndex);
        const isCanonical = canonicalOf.get(root) === clusterIndex;
        if (!isCanonical) {
          // Placeholder keeps the region-id <-> array-index invariant intact.
          regions.push({
            failure: "duplicate",
            roomIndex: -1,
            auto: false,
            touchesDoor: region.touchesDoor,
            pixelCount: 0,
            minX: 0,
            minY: 0,
            maxX: -1,
            maxY: -1,
            seeds: [],
            seedProbes: []
          });
          continue;
        }
        const fill: WatershedFill = { pixelCount: 0, minX: rasterWidth, minY: rasterHeight, maxX: -1, maxY: -1 };
        const seeds: PageSeed[] = [];
        const probes: number[] = [];
        for (let member = 0; member < roomClusters.length; member += 1) {
          if (findGroup(member) !== root) {
            continue;
          }
          const memberFill = fills[member];
          fill.pixelCount += memberFill.pixelCount;
          fill.minX = Math.min(fill.minX, memberFill.minX);
          fill.minY = Math.min(fill.minY, memberFill.minY);
          fill.maxX = Math.max(fill.maxX, memberFill.maxX);
          fill.maxY = Math.max(fill.maxY, memberFill.maxY);
          seeds.push(...roomClusters[member].seeds);
          probes.push(...roomClusters[member].probes);
        }
        regions.push({
          failure: fill.pixelCount < options.minRoomAreaPixels ? "tooSmall" : null,
          roomIndex: -1,
          auto: false,
          touchesDoor: region.touchesDoor,
          pixelCount: fill.pixelCount,
          minX: fill.minX,
          minY: fill.minY,
          maxX: fill.maxX,
          maxY: fill.maxY,
          seeds,
          seedProbes: probes
        });
      }
    }
  }

  // Split oversized label-less regions the same way: virtual seeds planted at local
  // clearance maxima (the centers of open pockets) grow into a stub-anchored watershed,
  // and the clearance merge-back re-joins whatever is genuinely one continuous space.
  // This is the only partitioning available on pages whose text is drawn as paths.
  // Off by default: it raises meanIoU/recall on such pages but costs more precision
  // than it gains (extra unmatched pieces), measured against the pdf-tsv ground truth.
  if (options.splitUnlabeledRegions) {
    const oversizedMinPixels = Math.max(4 * options.minRoomAreaPixels, Math.round((6 * doorGapMax * scale) ** 2));
    const frontierMaxPx = 3 * doorGapMax * scale;
    const frontierClearanceMax = 4.5 * doorGapMax * scale;
    const originalRegionCount = regions.length;
    for (let regionIndex = 0; regionIndex < originalRegionCount; regionIndex += 1) {
      const region = regions[regionIndex];
      if (region.failure || region.seeds.length > 0 || region.pixelCount < oversizedMinPixels) {
        continue;
      }
      clearance ??= buildClearanceField(occupancy, rasterWidth, rasterHeight);
      const maxima = findClearanceMaxima(regionMap, clearance, rasterWidth, rasterHeight, regionIndex + 1, region, doorGapMax * scale);
      if (maxima.length < 2 || nextRegionId + maxima.length > EXTERIOR_REGION_ID) {
        continue;
      }

      const virtualClusters: SeedCluster[] = maxima.map((index) => ({
        x: index % rasterWidth,
        y: Math.floor(index / rasterWidth),
        roomLike: false,
        seeds: [],
        probes: [index]
      }));
      const newIds = virtualClusters.map(() => {
        const id = nextRegionId;
        nextRegionId += 1;
        return id;
      });
      const { fills, frontiers } = watershedSplitRegion(regionMap, clearance, rasterWidth, rasterHeight, regionIndex + 1, virtualClusters, newIds);

      const groupOf = new Int32Array(virtualClusters.length);
      for (let clusterIndex = 0; clusterIndex < virtualClusters.length; clusterIndex += 1) {
        groupOf[clusterIndex] = clusterIndex;
      }
      const findGroup = (clusterIndex: number): number => {
        let root = clusterIndex;
        while (groupOf[root] !== root) {
          root = groupOf[root];
        }
        return root;
      };
      for (const [key, frontier] of frontiers) {
        if (frontier.maxClearance > frontierClearanceMax || frontier.lengthPx > frontierMaxPx) {
          const a = findGroup(Math.floor(key / 4096));
          const b = findGroup(key % 4096);
          if (a !== b) {
            groupOf[a] = b;
          }
        }
      }
      const canonicalOf = new Map<number, number>();
      for (let clusterIndex = 0; clusterIndex < virtualClusters.length; clusterIndex += 1) {
        const root = findGroup(clusterIndex);
        if (!canonicalOf.has(root)) {
          canonicalOf.set(root, clusterIndex);
        }
      }

      const repaint = new Map<number, number>();
      if (canonicalOf.size <= 1) {
        for (const id of newIds) {
          repaint.set(id, regionIndex + 1);
        }
      } else {
        for (let clusterIndex = 0; clusterIndex < virtualClusters.length; clusterIndex += 1) {
          repaint.set(newIds[clusterIndex], newIds[canonicalOf.get(findGroup(clusterIndex)) as number]);
        }
      }
      let needsRepaint = false;
      for (const [from, to] of repaint) {
        if (from !== to) {
          needsRepaint = true;
        }
      }
      if (needsRepaint) {
        const repaintMinX = Math.max(0, region.minX);
        const repaintMaxX = Math.min(rasterWidth - 1, region.maxX);
        for (let y = Math.max(0, region.minY); y <= Math.min(rasterHeight - 1, region.maxY); y += 1) {
          const rowBase = y * rasterWidth;
          for (let x = repaintMinX; x <= repaintMaxX; x += 1) {
            const target = repaint.get(regionMap[rowBase + x]);
            if (target !== undefined) {
              regionMap[rowBase + x] = target;
            }
          }
        }
      }

      if (canonicalOf.size <= 1) {
        // Everything merged back: the parent stays as it was; placeholders keep the
        // region-id <-> array-index invariant.
        for (let k = 0; k < newIds.length; k += 1) {
          regions.push({
            failure: "duplicate",
            roomIndex: -1,
            auto: true,
            touchesDoor: region.touchesDoor,
            pixelCount: 0,
            minX: 0,
            minY: 0,
            maxX: -1,
            maxY: -1,
            seeds: [],
            seedProbes: []
          });
        }
        continue;
      }

      region.failure = "duplicate"; // parent retired in favor of its splits
      for (let clusterIndex = 0; clusterIndex < virtualClusters.length; clusterIndex += 1) {
        const root = findGroup(clusterIndex);
        if (canonicalOf.get(root) !== clusterIndex) {
          regions.push({
            failure: "duplicate",
            roomIndex: -1,
            auto: true,
            touchesDoor: region.touchesDoor,
            pixelCount: 0,
            minX: 0,
            minY: 0,
            maxX: -1,
            maxY: -1,
            seeds: [],
            seedProbes: []
          });
          continue;
        }
        const fill: WatershedFill = { pixelCount: 0, minX: rasterWidth, minY: rasterHeight, maxX: -1, maxY: -1 };
        for (let member = 0; member < virtualClusters.length; member += 1) {
          if (findGroup(member) !== root) {
            continue;
          }
          const memberFill = fills[member];
          fill.pixelCount += memberFill.pixelCount;
          fill.minX = Math.min(fill.minX, memberFill.minX);
          fill.minY = Math.min(fill.minY, memberFill.minY);
          fill.maxX = Math.max(fill.maxX, memberFill.maxX);
          fill.maxY = Math.max(fill.maxY, memberFill.maxY);
        }
        regions.push({
          failure: fill.pixelCount < autoMinAreaPixels ? "tooSmall" : null,
          roomIndex: -1,
          auto: true,
          touchesDoor: region.touchesDoor,
          pixelCount: fill.pixelCount,
          minX: fill.minX,
          minY: fill.minY,
          maxX: fill.maxX,
          maxY: fill.maxY,
          seeds: [],
          seedProbes: []
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

    // Rasterized contours run along the edges of the round-capped wall stamps, which
    // erode roughly one raster pixel from every room; nudging the final polygon back
    // out recovers it (measured against the pdf-tsv ground truth).
    const boundaryOffset = options.boundaryOffsetFactor * pageDiagonal;
    if (boundaryOffset > 0) {
      oriented = offsetPolygonOutward(oriented, boundaryOffset);
      area = Math.abs(signedPolygonArea(oriented));
    }

    const labels = region.seeds
      .map((seed) => seed.item)
      .filter((item): item is SceneTextItem => item !== null)
      .sort((a, b) => (b.minY + b.maxY) / 2 - (a.minY + a.maxY) / 2);

    // Tiny enclosed pockets whose only text is annotation-like (equipment tags,
    // dimensions) are fixtures or symbol frames, not rooms. Real rooms either carry a
    // room-like label or exceed fixture proportions.
    const fixturePocketMaxArea = (1.5 * doorGapMax) ** 2;
    if (labels.length > 0 && area < fixturePocketMaxArea && !labels.some((item) => isRoomLikeLabel(item.text))) {
      region.failure = "tooSmall";
      for (const seed of region.seeds) {
        failedSeeds.push({ seed: seed.asRoomSeed, reason: "tooSmall" });
      }
      continue;
    }

    // Room-likeness signals: mean thickness (2*area/perimeter — the width of elongated
    // shapes) and bounding-box fill. A band thinner than roughly half a door opening is
    // a wall cavity (the free space between the two faces of a thick wall), not a room
    // a person could occupy — the failure mode where slivers between rooms or along the
    // building shell were detected as rooms.
    let perimeter = 0;
    let roomMinX = Infinity;
    let roomMinY = Infinity;
    let roomMaxX = -Infinity;
    let roomMaxY = -Infinity;
    for (let i = 0; i + 1 < oriented.length; i += 2) {
      const j = (i + 2) % oriented.length;
      perimeter += Math.hypot(oriented[j] - oriented[i], oriented[j + 1] - oriented[i + 1]);
      roomMinX = Math.min(roomMinX, oriented[i]);
      roomMaxX = Math.max(roomMaxX, oriented[i]);
      roomMinY = Math.min(roomMinY, oriented[i + 1]);
      roomMaxY = Math.max(roomMaxY, oriented[i + 1]);
    }
    const meanThickness = (2 * area) / Math.max(perimeter, 1e-9);
    const roomLikeLabeled = labels.some((item) => isRoomLikeLabel(item.text));
    const cavityMaxThickness = doorGapMax * (roomLikeLabeled ? 0.3 : 0.55);
    if (meanThickness < cavityMaxThickness) {
      region.failure = "wallCavity";
      for (const seed of region.seeds) {
        failedSeeds.push({ seed: seed.asRoomSeed, reason: "wallCavity" });
      }
      continue;
    }

    const bboxFill = area / Math.max(1e-9, (roomMaxX - roomMinX) * (roomMaxY - roomMinY));
    const thicknessScore = Math.min(1, meanThickness / (1.2 * doorGapMax));
    const confidence = Math.max(
      0,
      Math.min(1, 0.35 * thicknessScore + 0.3 * bboxFill + (roomLikeLabeled ? 0.25 : 0) + (labels.length > 0 ? 0.1 : 0))
    );

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
      roomNumber: pickRoomNumber(labelTexts),
      confidence,
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

  return stats;
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

  // PDF sources carry text items directly; parsed-zip sources carry the searchable
  // text index instead, from which word-level items are derived.
  const textContent = scene.textContent ?? deriveTextItemsFromIndex(scene, pageIndex);
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

/**
 * Word-level text items derived from one page of the scene's searchable text index
 * (the text carrier of parsed-zip sources). Runs between separator chars become one
 * item each; bounds come from the same glyph-instance math the text search uses.
 */
function deriveTextItemsFromIndex(scene: VectorScene, pageIndex: number): SceneTextItem[] {
  const page = scene.textIndex?.pages[pageIndex];
  const items: SceneTextItem[] = [];
  if (!page || page.text.length === 0) {
    return items;
  }

  const charInstance = page.charInstance;
  let runStart = -1;
  for (let i = 0; i <= charInstance.length; i += 1) {
    const isSeparator = i === charInstance.length || charInstance[i] === -1;
    if (!isSeparator) {
      if (runStart < 0) {
        runStart = i;
      }
      continue;
    }
    if (runStart >= 0) {
      const text = page.text.slice(runStart, i).trim();
      const bounds = computeTextRunBounds(scene, page, runStart, i);
      if (text.length > 0 && bounds) {
        items.push({ text, ...bounds, pageIndex });
      }
      runStart = -1;
    }
  }
  return items;
}

/**
 * Scene-space bounding box of a character run in a page text index: chars referencing a
 * text instance get the glyph ink box transformed by the instance matrix, fallback
 * chars use their stored quad (same math as the text-search highlight bounds).
 */
function computeTextRunBounds(
  scene: VectorScene,
  page: PageTextIndex,
  startChar: number,
  endChar: number
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const instanceA = scene.textInstanceA;
  const instanceB = scene.textInstanceB;
  const glyphMetaA = scene.textGlyphMetaA;
  const glyphMetaB = scene.textGlyphMetaB;
  const fallbackQuads = page.fallbackQuads;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const end = Math.min(endChar, page.charInstance.length);
  for (let i = startChar; i < end; i += 1) {
    const ref = page.charInstance[i];
    if (ref === -1) {
      continue;
    }

    if (ref <= -2) {
      const q = (-ref - 2) * 4;
      if (q + 3 < fallbackQuads.length) {
        minX = Math.min(minX, fallbackQuads[q]);
        minY = Math.min(minY, fallbackQuads[q + 1]);
        maxX = Math.max(maxX, fallbackQuads[q + 2]);
        maxY = Math.max(maxY, fallbackQuads[q + 3]);
      }
      continue;
    }

    const o = ref * 4;
    if (o + 3 >= instanceA.length || o + 3 >= instanceB.length) {
      continue;
    }
    const a = instanceA[o];
    const b = instanceA[o + 1];
    const c = instanceA[o + 2];
    const d = instanceA[o + 3];
    const e = instanceB[o];
    const f = instanceB[o + 1];
    const g = Math.trunc(instanceB[o + 2]) * 4;
    if (g < 0 || g + 3 >= glyphMetaA.length || g + 1 >= glyphMetaB.length) {
      continue;
    }
    const inkMinX = glyphMetaA[g + 2];
    const inkMinY = glyphMetaA[g + 3];
    const inkMaxX = glyphMetaB[g];
    const inkMaxY = glyphMetaB[g + 1];

    const x00 = a * inkMinX + c * inkMinY + e;
    const y00 = b * inkMinX + d * inkMinY + f;
    const x01 = a * inkMinX + c * inkMaxY + e;
    const y01 = b * inkMinX + d * inkMaxY + f;
    const x10 = a * inkMaxX + c * inkMinY + e;
    const y10 = b * inkMaxX + d * inkMinY + f;
    const x11 = a * inkMaxX + c * inkMaxY + e;
    const y11 = b * inkMaxX + d * inkMaxY + f;

    minX = Math.min(minX, x00, x01, x10, x11);
    minY = Math.min(minY, y00, y01, y10, y11);
    maxX = Math.max(maxX, x00, x01, x10, x11);
    maxY = Math.max(maxY, y00, y01, y10, y11);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !(maxX > minX) || !(maxY > minY)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

interface StageAResult {
  walls: Float64Array;
  /** Door-swing arcs (tight curves) as [x0, y0, x1, y1, halfWidth] runs: they both seal doorways and mark them as doors. */
  doorArcs: Float64Array;
  eligibleSegmentCount: number;
  totalStrokeLength: number;
  widthHistogram: { halfWidth: number; totalLength: number; segmentCount: number }[];
  wallHalfWidthThreshold: number;
  wallMedianHalfWidth: number;
  /** True when stroke width carried no signal and every eligible stroke was accepted. */
  uniformWidthMode: boolean;
  /** All eligible straight strokes [x0,y0,x1,y1] (double-line mode only; feeds the hybrid density layer). */
  rawSegments?: Float64Array;
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
    const x1 = endpoints[base + 2];
    const y1 = endpoints[base + 3];
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

  // When the width threshold accepts nearly all stroke length, thickness carries no
  // signal (uniformly thin CAD exports); the caller then falls back to ink-density
  // filtering on the rasterized occupancy.
  let thresholdCoverage = 0;
  for (const bucket of widthHistogram) {
    if (bucket.halfWidth >= wallHalfWidthThreshold) {
      thresholdCoverage += bucket.totalLength;
    }
  }
  const uniformWidthMode = totalStrokeLength > 0 && thresholdCoverage / totalStrokeLength > 0.85;

  // Second pass: collect wall subsegments (flattening quadratics into polylines).
  // Besides strokes at full wall thickness, long straight strokes at medium thickness
  // are accepted too: glass/curtain walls are often drawn thinner than solid walls but
  // much longer than furniture or door-arc pieces.
  const longWallMinLength = 0.01 * pageDiagonal;
  const longWallHalfWidthMin = options.longWallHalfWidthMinFactor * wallHalfWidthThreshold;
  // Walls are almost never tightly curved; door-swing arcs, chairs, and similar symbols
  // are. Tight curves are rejected by their curvature radius, while gently curved
  // building walls (large radius) survive.
  const curveRadiusMin = 0.012 * pageDiagonal;
  const doubleLineMode = options.wallDetectionMode === "doubleLine";
  const walls: number[] = [];
  const doorArcs: number[] = [];
  const rawStraightSegments: number[] = [];
  const acceptedWidthLengths: { halfWidth: number; length: number }[] = [];
  for (const i of eligible) {
    const base = i * 4;
    const halfWidth = styles[base];
    const x0 = endpoints[base];
    const y0 = endpoints[base + 1];
    const endX = endpoints[base + 2];
    const endY = endpoints[base + 3];
    const primitiveType = primitiveMeta[base + 2];

    if (primitiveType === 1) {
      const cx = primitiveMeta[base];
      const cy = primitiveMeta[base + 1];
      const chord = Math.hypot(endX - x0, endY - y0);
      const sagitta = Math.hypot(x0 - 2 * cx + endX, y0 - 2 * cy + endY) / 4;
      if (sagitta > 0.05 * Math.max(chord, 1e-9)) {
        const radius = (chord * chord) / (8 * sagitta) + sagitta / 2;
        if (radius < curveRadiusMin) {
          // Tight curve: flatten coarsely into the door-arc set instead of the walls.
          let prevX = x0;
          let prevY = y0;
          for (let k = 1; k <= 4; k += 1) {
            const t = k / 4;
            const mt = 1 - t;
            const px = mt * mt * x0 + 2 * mt * t * cx + t * t * endX;
            const py = mt * mt * y0 + 2 * mt * t * cy + t * t * endY;
            doorArcs.push(prevX, prevY, px, py, halfWidth);
            prevX = px;
            prevY = py;
          }
          continue;
        }
      }
    }

    if (doubleLineMode) {
      // Double-line mode classifies by parallel-pair structure instead of width; collect
      // every straight piece (gentle curves rarely form wall faces and are skipped).
      if (primitiveType === 0) {
        rawStraightSegments.push(x0, y0, endX, endY);
      }
      continue;
    }

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
      // Quadratic: primitiveMeta[0..1] is the control point; flatten into 8 subsegments.
      const cx = primitiveMeta[base];
      const cy = primitiveMeta[base + 1];
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

  if (doubleLineMode) {
    const medianEligibleHalfWidth = lengthWeightedMedianHalfWidth(
      widthHistogram.map((bucket) => ({ halfWidth: bucket.halfWidth, length: bucket.totalLength }))
    );
    const doubleLineWalls = buildDoubleLineWalls(
      rawStraightSegments,
      pageMinX,
      pageMinY,
      pageMaxX,
      pageMaxY,
      pageDiagonal,
      medianEligibleHalfWidth,
      longWallMinLength
    );
    for (let i = 0; i + 4 < doubleLineWalls.length; i += WALL_STRIDE) {
      acceptedWidthLengths.push({
        halfWidth: doubleLineWalls[i + 4],
        length: Math.hypot(doubleLineWalls[i + 2] - doubleLineWalls[i], doubleLineWalls[i + 3] - doubleLineWalls[i + 1])
      });
    }
    return {
      walls: new Float64Array(doubleLineWalls),
      doorArcs: new Float64Array(doorArcs),
      eligibleSegmentCount: eligible.length,
      totalStrokeLength,
      widthHistogram,
      wallHalfWidthThreshold,
      wallMedianHalfWidth: lengthWeightedMedianHalfWidth(acceptedWidthLengths),
      uniformWidthMode,
      rawSegments: new Float64Array(rawStraightSegments)
    };
  }

  const wallsFiltered = dropPolylineArcChains(walls, curveRadiusMin, doorArcs);

  return {
    walls: new Float64Array(wallsFiltered),
    doorArcs: new Float64Array(doorArcs),
    eligibleSegmentCount: eligible.length,
    totalStrokeLength,
    widthHistogram,
    wallHalfWidthThreshold,
    wallMedianHalfWidth: lengthWeightedMedianHalfWidth(acceptedWidthLengths),
    uniformWidthMode
  };
}

/**
 * Detect walls drawn as pairs of long parallel thin lines (the two wall faces) and
 * return synthesized wall segments covering the cavity between each pair.
 *
 * Strokes are first merged into collinear chains (dashed walls become one chain), then
 * chains of sufficient length are paired with a parallel partner at a wall-cavity
 * offset. A pair is rejected when a third chain runs inside the cavity (hatching and
 * other periodic patterns are not two-line structures). Chains that never pair but are
 * long enough on their own are kept as single-line walls (glazing, single-stroke
 * partitions) so plans that mix both conventions stay closed.
 *
 * Input segments are `[x0, y0, x1, y1]` runs; the result uses the wall stride
 * `[x0, y0, x1, y1, halfWidth]` with the half-width spanning the cavity.
 */
function buildDoubleLineWalls(
  segments: number[],
  pageMinX: number,
  pageMinY: number,
  pageMaxX: number,
  pageMaxY: number,
  pageDiagonal: number,
  strokeHalfWidth: number,
  longSingleMinLength: number
): number[] {
  const BIN_COUNT = 120; // 1.5 degrees of line angle per bin (axial doubling below)
  const offsetTol = Math.max(0.0004 * pageDiagonal, 2 * strokeHalfWidth);
  const chainGapTol = 0.0025 * pageDiagonal;
  const minChainLength = 0.006 * pageDiagonal;
  const minCavity = Math.max(0.0008 * pageDiagonal, 2.5 * strokeHalfWidth);
  const maxCavity = 0.005 * pageDiagonal;

  // Coarse ink grid over every straight stroke: used to test that a candidate pair's
  // cavity is empty along its length. Wall cavities carry ink only at door jambs, while
  // furniture, hatching, and stair treads have caps or infill crossing the midline.
  const inkScale = 2048 / Math.max(1e-6, Math.max(pageMaxX - pageMinX, pageMaxY - pageMinY));
  const inkWidth = Math.max(4, Math.ceil((pageMaxX - pageMinX) * inkScale) + 2);
  const inkHeight = Math.max(4, Math.ceil((pageMaxY - pageMinY) * inkScale) + 2);
  const ink = new Uint8Array(inkWidth * inkHeight);
  const inkAt = (wx: number, wy: number): number => {
    const gx = Math.round((wx - pageMinX) * inkScale) + 1;
    const gy = Math.round((wy - pageMinY) * inkScale) + 1;
    if (gx < 0 || gy < 0 || gx >= inkWidth || gy >= inkHeight) {
      return 0;
    }
    return ink[gy * inkWidth + gx];
  };
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const gx0 = (segments[i] - pageMinX) * inkScale + 1;
    const gy0 = (segments[i + 1] - pageMinY) * inkScale + 1;
    const gx1 = (segments[i + 2] - pageMinX) * inkScale + 1;
    const gy1 = (segments[i + 3] - pageMinY) * inkScale + 1;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(gx1 - gx0), Math.abs(gy1 - gy0))));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const gx = Math.round(gx0 + (gx1 - gx0) * t);
      const gy = Math.round(gy0 + (gy1 - gy0) * t);
      if (gx >= 0 && gy >= 0 && gx < inkWidth && gy < inkHeight) {
        ink[gy * inkWidth + gx] = 1;
      }
    }
  }

  interface BinnedSegment {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    length: number;
    cos2: number;
    sin2: number;
  }

  // Bin by undirected line angle. Doubling the angle makes opposite directions
  // identical and lets bin means be computed without a wrap-around seam.
  const bins = new Map<number, BinnedSegment[]>();
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const x0 = segments[i];
    const y0 = segments[i + 1];
    const x1 = segments[i + 2];
    const y1 = segments[i + 3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) {
      continue;
    }
    const theta = Math.atan2(dy, dx);
    const cos2 = Math.cos(2 * theta);
    const sin2 = Math.sin(2 * theta);
    const phi = Math.atan2(sin2, cos2);
    const binIndex = Math.round(((phi + Math.PI) / (2 * Math.PI)) * BIN_COUNT) % BIN_COUNT;
    let bin = bins.get(binIndex);
    if (!bin) {
      bin = [];
      bins.set(binIndex, bin);
    }
    bin.push({ x0, y0, x1, y1, length, cos2, sin2 });
  }

  interface Chain {
    c: number;
    t0: number;
    t1: number;
    paired: boolean;
  }

  const walls: number[] = [];

  for (const bin of bins.values()) {
    // Length-weighted mean line direction of the bin (axial mean, then halved).
    let sumCos2 = 0;
    let sumSin2 = 0;
    for (const segment of bin) {
      sumCos2 += segment.cos2 * segment.length;
      sumSin2 += segment.sin2 * segment.length;
    }
    const meanTheta = Math.atan2(sumSin2, sumCos2) / 2;
    const dirX = Math.cos(meanTheta);
    const dirY = Math.sin(meanTheta);
    const normX = -dirY;
    const normY = dirX;

    // Project every segment into the (direction, normal) frame of the bin.
    const projected = bin.map((segment) => {
      const ta = dirX * segment.x0 + dirY * segment.y0;
      const tb = dirX * segment.x1 + dirY * segment.y1;
      const c = (normX * (segment.x0 + segment.x1) + normY * (segment.y0 + segment.y1)) / 2;
      return { c, t0: Math.min(ta, tb), t1: Math.max(ta, tb), length: segment.length };
    });
    projected.sort((a, b) => a.c - b.c || a.t0 - b.t0);

    // Merge collinear runs (same normal offset, small longitudinal gap) into chains.
    // Clusters are bounded by total offset extent, not consecutive gaps: dense drawings
    // have near-continuous offset coverage, and a gap-based sweep would fuse separate
    // parallel lines (including the two faces of a wall) into one blur.
    const chains: Chain[] = [];
    let clusterStart = 0;
    for (let i = 1; i <= projected.length; i += 1) {
      if (i < projected.length && projected[i].c - projected[clusterStart].c <= offsetTol) {
        continue;
      }
      const cluster = projected.slice(clusterStart, i).sort((a, b) => a.t0 - b.t0);
      clusterStart = i;
      let current = { c: cluster[0].c * cluster[0].length, weight: cluster[0].length, t0: cluster[0].t0, t1: cluster[0].t1 };
      const flush = (): void => {
        chains.push({ c: current.c / Math.max(1e-9, current.weight), t0: current.t0, t1: current.t1, paired: false });
      };
      for (let k = 1; k < cluster.length; k += 1) {
        const piece = cluster[k];
        if (piece.t0 <= current.t1 + chainGapTol) {
          current.t1 = Math.max(current.t1, piece.t1);
          current.c += piece.c * piece.length;
          current.weight += piece.length;
        } else {
          flush();
          current = { c: piece.c * piece.length, weight: piece.length, t0: piece.t0, t1: piece.t1 };
        }
      }
      flush();
    }

    const candidates = chains.filter((chain) => chain.t1 - chain.t0 >= minChainLength).sort((a, b) => a.c - b.c);

    // Pair each chain with parallel partners at a wall-cavity offset.
    for (let i = 0; i < candidates.length; i += 1) {
      const faceA = candidates[i];
      for (let j = i + 1; j < candidates.length; j += 1) {
        const faceB = candidates[j];
        const cavity = faceB.c - faceA.c;
        if (cavity > maxCavity) {
          break;
        }
        if (cavity < minCavity) {
          continue;
        }
        const overlap0 = Math.max(faceA.t0, faceB.t0);
        const overlap1 = Math.min(faceA.t1, faceB.t1);
        const overlap = overlap1 - overlap0;
        const spanA = faceA.t1 - faceA.t0;
        const spanB = faceB.t1 - faceB.t0;
        if (overlap < Math.max(0.8 * minChainLength, 0.35 * Math.min(spanA, spanB))) {
          continue;
        }

        // Hatch guard: a third chain running inside the cavity means this is a striped
        // pattern (hatching, stair treads), not the two faces of one wall.
        let occupied = false;
        for (let k = i + 1; k < j; k += 1) {
          const inner = candidates[k];
          if (inner.c <= faceA.c + 0.25 * cavity || inner.c >= faceB.c - 0.25 * cavity) {
            continue;
          }
          const innerOverlap = Math.min(inner.t1, overlap1) - Math.max(inner.t0, overlap0);
          if (innerOverlap >= 0.3 * overlap) {
            occupied = true;
            break;
          }
        }
        if (occupied) {
          continue;
        }

        // Cavity-emptiness: sample the midline on the ink grid. Furniture pairs have
        // caps/infill crossing the cavity; wall cavities are clear except door jambs.
        const cMid = (faceA.c + faceB.c) / 2;
        const sampleStep = 2 / Math.max(1e-6, inkScale);
        const sampleCount = Math.max(4, Math.floor(overlap / sampleStep));
        let inkedSamples = 0;
        for (let s = 0; s <= sampleCount; s += 1) {
          const t = overlap0 + (overlap / sampleCount) * s;
          if (inkAt(dirX * t + normX * cMid, dirY * t + normY * cMid) !== 0) {
            inkedSamples += 1;
          }
        }
        if (inkedSamples / (sampleCount + 1) > 0.15) {
          continue;
        }

        walls.push(
          dirX * overlap0 + normX * cMid,
          dirY * overlap0 + normY * cMid,
          dirX * overlap1 + normX * cMid,
          dirY * overlap1 + normY * cMid,
          cavity / 2 + strokeHalfWidth
        );
        faceA.paired = true;
        faceB.paired = true;
      }
    }

    // Unpaired long chains still count as (single-line) walls, but only in directions
    // that carry real (paired) walls: isolated diagonal leader/section lines otherwise
    // become fake walls slicing through rooms.
    const binHasPairs = candidates.some((chain) => chain.paired);
    if (!binHasPairs) {
      continue;
    }
    for (const chain of candidates) {
      if (chain.paired || chain.t1 - chain.t0 < longSingleMinLength) {
        continue;
      }
      walls.push(
        dirX * chain.t0 + normX * chain.c,
        dirY * chain.t0 + normY * chain.c,
        dirX * chain.t1 + normX * chain.c,
        dirY * chain.t1 + normY * chain.c,
        strokeHalfWidth
      );
    }
  }

  return walls;
}

/**
 * Drop chains of short end-to-end segments that turn consistently with a small radius:
 * door-swing arcs and circle symbols are commonly exported as polylines rather than
 * curve primitives. Straight walls (no turning), sharp corners (single large turns), and
 * gently curved walls (large radius) all survive.
 */
function dropPolylineArcChains(walls: number[], curveRadiusMin: number, doorArcs: number[]): number[] {
  const wallCount = walls.length / WALL_STRIDE;
  const pieceMaxLength = 0.4 * curveRadiusMin;
  if (wallCount === 0 || !(pieceMaxLength > 0)) {
    return walls;
  }

  // Endpoint adjacency over the short segments only (arc pieces are short).
  const shortIndexes: number[] = [];
  const isShort = new Uint8Array(wallCount);
  for (let i = 0; i < wallCount; i += 1) {
    const base = i * WALL_STRIDE;
    const length = Math.hypot(walls[base + 2] - walls[base], walls[base + 3] - walls[base + 1]);
    if (length > 1e-9 && length <= pieceMaxLength) {
      isShort[i] = 1;
      shortIndexes.push(i);
    }
  }
  if (shortIndexes.length < 4) {
    return walls;
  }

  const keyOf = (x: number, y: number): string => `${Math.round(x * 16)},${Math.round(y * 16)}`;
  const byEndpoint = new Map<string, number[]>();
  for (const i of shortIndexes) {
    const base = i * WALL_STRIDE;
    for (const key of [keyOf(walls[base], walls[base + 1]), keyOf(walls[base + 2], walls[base + 3])]) {
      const list = byEndpoint.get(key);
      if (list) {
        list.push(i);
      } else {
        byEndpoint.set(key, [i]);
      }
    }
  }

  const visited = new Uint8Array(wallCount);
  const drop = new Uint8Array(wallCount);
  const chain: number[] = [];

  for (const start of shortIndexes) {
    if (visited[start]) {
      continue;
    }
    // Walk the chain in both directions from the start segment.
    chain.length = 0;
    chain.push(start);
    visited[start] = 1;
    let totalTurn = 0;
    let totalLength = segmentLengthAt(walls, start);

    for (const direction of [0, 1] as const) {
      let current = start;
      let endX = walls[start * WALL_STRIDE + (direction === 0 ? 2 : 0)];
      let endY = walls[start * WALL_STRIDE + (direction === 0 ? 3 : 1)];
      let headingX = direction === 0 ? endX - walls[start * WALL_STRIDE] : endX - walls[start * WALL_STRIDE + 2];
      let headingY = direction === 0 ? endY - walls[start * WALL_STRIDE + 1] : endY - walls[start * WALL_STRIDE + 3];
      let turnSign = 0;

      for (;;) {
        const neighbors = byEndpoint.get(keyOf(endX, endY)) ?? [];
        let next = -1;
        for (const candidate of neighbors) {
          if (candidate !== current && !visited[candidate]) {
            if (next >= 0) {
              next = -2; // junction: more than one continuation
              break;
            }
            next = candidate;
          }
        }
        if (next < 0) {
          break;
        }
        const nextBase = next * WALL_STRIDE;
        // Orient the next piece to continue from (endX, endY).
        const forwardFromStart = keyOf(walls[nextBase], walls[nextBase + 1]) === keyOf(endX, endY);
        const nextEndX = forwardFromStart ? walls[nextBase + 2] : walls[nextBase];
        const nextEndY = forwardFromStart ? walls[nextBase + 3] : walls[nextBase + 1];
        const nextHeadingX = nextEndX - endX;
        const nextHeadingY = nextEndY - endY;
        const cross = headingX * nextHeadingY - headingY * nextHeadingX;
        const dot = headingX * nextHeadingX + headingY * nextHeadingY;
        const turn = Math.atan2(cross, dot);
        const turnDegrees = Math.abs(turn) * (180 / Math.PI);
        if (turnDegrees < 0.5 || turnDegrees > 45) {
          break; // straight continuation or sharp corner: not an arc step
        }
        const sign = turn > 0 ? 1 : -1;
        if (turnSign !== 0 && sign !== turnSign) {
          break; // zigzag, not an arc
        }
        turnSign = sign;
        visited[next] = 1;
        chain.push(next);
        totalTurn += Math.abs(turn);
        totalLength += Math.hypot(nextHeadingX, nextHeadingY);
        current = next;
        endX = nextEndX;
        endY = nextEndY;
        headingX = nextHeadingX;
        headingY = nextHeadingY;
      }
    }

    if (chain.length >= 4 && totalTurn >= (40 * Math.PI) / 180) {
      const radius = totalLength / totalTurn;
      if (radius < curveRadiusMin) {
        for (const index of chain) {
          drop[index] = 1;
        }
      }
    }
  }

  let dropped = 0;
  for (let i = 0; i < wallCount; i += 1) {
    dropped += drop[i];
  }
  if (dropped === 0) {
    return walls;
  }
  const kept: number[] = [];
  for (let i = 0; i < wallCount; i += 1) {
    const base = i * WALL_STRIDE;
    if (drop[i]) {
      doorArcs.push(walls[base], walls[base + 1], walls[base + 2], walls[base + 3], walls[base + 4]);
    } else {
      kept.push(walls[base], walls[base + 1], walls[base + 2], walls[base + 3], walls[base + 4]);
    }
  }
  return kept;
}

function segmentLengthAt(walls: number[], index: number): number {
  const base = index * WALL_STRIDE;
  return Math.hypot(walls[base + 2] - walls[base], walls[base + 3] - walls[base + 1]);
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
 * Erase sparsely inked occupancy: keep a pixel only when the surrounding window has
 * enough ink coverage. Wall bands (double faces, hatch fill, thick strokes) ink a wide
 * footprint and survive; isolated single-line strokes (furniture outlines, door leaves,
 * annotation symbols) do not.
 */
function filterOccupancyByDensity(
  occupancy: Uint8Array,
  width: number,
  height: number,
  windowRadius: number,
  minCoverage: number
): void {
  const stride = width + 1;
  const integral = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const rowBase = y * width;
    const outBase = (y + 1) * stride;
    const prevBase = y * stride;
    for (let x = 0; x < width; x += 1) {
      rowSum += occupancy[rowBase + x];
      integral[outBase + x + 1] = integral[prevBase + x + 1] + rowSum;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - windowRadius);
    const y1 = Math.min(height - 1, y + windowRadius);
    const rowBase = y * width;
    for (let x = 0; x < width; x += 1) {
      if (occupancy[rowBase + x] === 0) {
        continue;
      }
      const x0 = Math.max(0, x - windowRadius);
      const x1 = Math.min(width - 1, x + windowRadius);
      const count =
        integral[(y1 + 1) * stride + x1 + 1] -
        integral[y0 * stride + x1 + 1] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];
      const windowArea = (x1 - x0 + 1) * (y1 - y0 + 1);
      if (count < minCoverage * windowArea) {
        occupancy[rowBase + x] = 0;
      }
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

/**
 * Chamfer 3-4 distance from every free pixel to the nearest occupied pixel (3 units per
 * orthogonal step). High values = open space, low values = near walls/stubs.
 */
function buildClearanceField(occupancy: Uint8Array, width: number, height: number): Int32Array {
  const clearance = new Int32Array(width * height);
  for (let i = 0; i < clearance.length; i += 1) {
    clearance[i] = occupancy[i] !== 0 ? 0 : 0x3fffffff;
  }
  chamferPass(clearance, width, height);
  return clearance;
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
  touchedDoor: boolean;
  aborted: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Scanline flood fill of free pixels (occupancy 0, region 0) writing `regionId`.
 * Touching the bitmap border or a pixel owned by `exteriorId` marks the region as
 * leaked (`touchedBorder`); touching a pixel of `closureMask` (a bridged door opening)
 * marks `touchedDoor`.
 */
function floodFillRegion(
  occupancy: Uint8Array,
  regionMap: Uint16Array,
  width: number,
  height: number,
  startIndex: number,
  regionId: number,
  maxPixels: number,
  exteriorId: number,
  closureMask: Uint8Array | null = null
): FloodFillResult {
  const result: FloodFillResult = {
    pixelCount: 0,
    touchedBorder: false,
    touchedDoor: false,
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
    if (closureMask && ((left > rowStart && closureMask[left - 1] !== 0) || (right < rowEnd && closureMask[right + 1] !== 0))) {
      result.touchedDoor = true;
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
          if (closureMask && closureMask[x + offset] !== 0) {
            result.touchedDoor = true;
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

/**
 * Remove small isolated connected components from the stamped occupancy bitmap
 * (equipment symbols, text drawn as outlines, label frames) and return the wall
 * subsegments that survive. Real walls form large connected networks; a cluster whose
 * bounding box spans less than `minSpanPx` and touches nothing else cannot bound a room.
 */
function pruneIsolatedWallComponents(
  occupancy: Uint8Array,
  width: number,
  height: number,
  walls: Float64Array,
  worldToRasterX: (wx: number) => number,
  worldToRasterY: (wy: number) => number,
  minSpanPx: number
): Float64Array {
  if (!(minSpanPx > 1)) {
    return walls;
  }
  const minSpanSquared = minSpanPx * minSpanPx;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const componentPixels: number[] = [];

  for (let start = 0; start < occupancy.length; start += 1) {
    if (occupancy[start] === 0 || visited[start] !== 0) {
      continue;
    }
    stack.length = 0;
    componentPixels.length = 0;
    stack.push(start);
    visited[start] = 1;
    let minX = start % width;
    let maxX = minX;
    let minY = Math.floor(start / width);
    let maxY = minY;
    // Pixels are only collected while the component could still be "small"; once its
    // bounding box exceeds the span limit it is a keeper and collection stops.
    let keep = false;

    while (stack.length > 0) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index - x) / width;
      if (!keep) {
        componentPixels.push(index);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        const spanX = maxX - minX;
        const spanY = maxY - minY;
        if (spanX * spanX + spanY * spanY >= minSpanSquared) {
          keep = true;
          componentPixels.length = 0;
        }
      }
      if (x > 0 && occupancy[index - 1] !== 0 && visited[index - 1] === 0) {
        visited[index - 1] = 1;
        stack.push(index - 1);
      }
      if (x < width - 1 && occupancy[index + 1] !== 0 && visited[index + 1] === 0) {
        visited[index + 1] = 1;
        stack.push(index + 1);
      }
      if (y > 0 && occupancy[index - width] !== 0 && visited[index - width] === 0) {
        visited[index - width] = 1;
        stack.push(index - width);
      }
      if (y < height - 1 && occupancy[index + width] !== 0 && visited[index + width] === 0) {
        visited[index + width] = 1;
        stack.push(index + width);
      }
    }

    if (!keep) {
      for (const index of componentPixels) {
        occupancy[index] = 0;
      }
    }
  }

  // Keep only wall subsegments whose midpoint still lies on occupied pixels.
  const kept: number[] = [];
  const wallCount = walls.length / WALL_STRIDE;
  for (let i = 0; i < wallCount; i += 1) {
    const base = i * WALL_STRIDE;
    const midX = Math.min(width - 1, Math.max(0, Math.round(worldToRasterX((walls[base] + walls[base + 2]) / 2))));
    const midY = Math.min(height - 1, Math.max(0, Math.round(worldToRasterY((walls[base + 1] + walls[base + 3]) / 2))));
    if (occupancy[midY * width + midX] !== 0) {
      kept.push(walls[base], walls[base + 1], walls[base + 2], walls[base + 3], walls[base + 4]);
    }
  }
  return kept.length === walls.length ? walls : new Float64Array(kept);
}

interface SeedCluster {
  seeds: PageSeed[];
  probes: number[];
  x: number;
  y: number;
  roomLike: boolean;
}

/**
 * Group a region's seeds into label clusters: stacked label lines (room name + number)
 * merge into one cluster, far-apart labels stay separate.
 */
function clusterLabelSeeds(seeds: PageSeed[], probes: number[]): SeedCluster[] {
  const count = seeds.length;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    parent[i] = i;
  }
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) {
      root = parent[root];
    }
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };

  const heights = seeds.map((seed) => (seed.item ? Math.max(1e-6, seed.item.maxY - seed.item.minY) : 0));
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const reach = 2.5 * (heights[i] + heights[j]);
      if (reach > 0 && Math.hypot(seeds[j].x - seeds[i].x, seeds[j].y - seeds[i].y) <= reach) {
        parent[find(i)] = find(j);
      }
    }
  }

  const clustersByRoot = new Map<number, SeedCluster>();
  for (let i = 0; i < count; i += 1) {
    const root = find(i);
    let cluster = clustersByRoot.get(root);
    if (!cluster) {
      cluster = { seeds: [], probes: [], x: 0, y: 0, roomLike: false };
      clustersByRoot.set(root, cluster);
    }
    cluster.seeds.push(seeds[i]);
    cluster.probes.push(probes[i]);
    cluster.roomLike = cluster.roomLike || isRoomLikeLabel(seeds[i].label);
  }
  for (const cluster of clustersByRoot.values()) {
    for (const seed of cluster.seeds) {
      cluster.x += seed.x / cluster.seeds.length;
      cluster.y += seed.y / cluster.seeds.length;
    }
  }
  return [...clustersByRoot.values()];
}

/**
 * Room labels are room numbers (1612A, 60C06, 200, S2) or room-name words (CORRIDOR,
 * HALL); electrical/dimension annotations (GFI, J, DM, +45", 15.26 SF) are not.
 */
/**
 * Offset a closed CCW polygon outward by `distance` (miter joins, capped for spikes).
 * Each vertex moves to the intersection of its two adjacent edges translated along
 * their outward normals; near-parallel or reflex-spike corners fall back to the mean
 * of the two translated positions so small offsets never explode.
 */
function offsetPolygonOutward(polygon: Float64Array | Float32Array, distance: number): Float64Array {
  const vertexCount = polygon.length / 2;
  if (vertexCount < 3) {
    return Float64Array.from(polygon);
  }

  const out = new Float64Array(polygon.length);
  const miterLimit = 3 * distance;
  for (let i = 0; i < vertexCount; i += 1) {
    const prev = ((i - 1 + vertexCount) % vertexCount) * 2;
    const curr = i * 2;
    const next = ((i + 1) % vertexCount) * 2;

    const ax = polygon[curr] - polygon[prev];
    const ay = polygon[curr + 1] - polygon[prev + 1];
    const bx = polygon[next] - polygon[curr];
    const by = polygon[next + 1] - polygon[curr + 1];
    const aLen = Math.hypot(ax, ay);
    const bLen = Math.hypot(bx, by);
    if (!(aLen > 1e-9) || !(bLen > 1e-9)) {
      out[curr] = polygon[curr];
      out[curr + 1] = polygon[curr + 1];
      continue;
    }

    // CCW winding keeps the interior on the left of each edge; outward is the right.
    const anx = ay / aLen;
    const any = -ax / aLen;
    const bnx = by / bLen;
    const bny = -bx / bLen;

    // Miter direction: bisector of the two outward normals, scaled so both offset
    // edge lines pass through the new vertex.
    const mx = anx + bnx;
    const my = any + bny;
    const mLen = Math.hypot(mx, my);
    const cosHalf = mLen / 2;
    let offsetX: number;
    let offsetY: number;
    if (cosHalf > 1e-6 && distance / cosHalf <= miterLimit) {
      const scale = distance / (cosHalf * mLen);
      offsetX = mx * scale;
      offsetY = my * scale;
    } else {
      offsetX = ((anx + bnx) / 2) * distance;
      offsetY = ((any + bny) / 2) * distance;
    }

    out[curr] = polygon[curr] + offsetX;
    out[curr + 1] = polygon[curr + 1] + offsetY;
  }
  return out;
}

/**
 * Best room-number candidate among a room's label texts. Room numbers always carry
 * digits — most often a few digits followed by one or two letters ("1324A", "1564C") —
 * while name-only labels ("LOCKERS", "DRESSING") describe the room type instead.
 * Digit+letter tokens win over digits-only tokens; label order breaks ties.
 */
function pickRoomNumber(labelTexts: string[]): string {
  let digitsOnlyCandidate = "";
  for (const text of labelTexts) {
    for (const rawToken of text.split(/\s+/)) {
      // Measurement annotations are not room numbers: signed offsets (+45), imperial
      // marks (45" / 6'), percentages, degrees.
      if (/^[+-]/.test(rawToken) || /["'′″°%]/.test(rawToken)) {
        continue;
      }
      const token = rawToken.replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, "");
      if (/^\d{1,6}[-.]?[A-Za-z]{1,2}$/.test(token)) {
        return token;
      }
      if (digitsOnlyCandidate === "" && /^\d{1,6}$/.test(token)) {
        digitsOnlyCandidate = token;
      }
    }
  }
  return digitsOnlyCandidate;
}

function isRoomLikeLabel(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 24) {
    return false;
  }
  if (!/\d/.test(trimmed)) {
    return /^[A-Z][A-Z &,./()'-]{3,}$/.test(trimmed);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9./-]*$/.test(trimmed) || /\d\.\d/.test(trimmed)) {
    return false;
  }
  const digitCount = (trimmed.match(/\d/g) ?? []).length;
  return digitCount >= 2 || /[A-Za-z]/.test(trimmed);
}

interface WatershedFill {
  pixelCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Local clearance maxima inside one region: the centers of its open pockets, used as
 * virtual watershed seeds when a region has no label seeds. Candidates must beat their
 * 4-neighborhood and clear a minimum openness; greedy non-max suppression keeps peaks
 * at least a room-scale distance apart.
 */
function findClearanceMaxima(
  regionMap: Uint16Array,
  clearance: Int32Array,
  width: number,
  height: number,
  regionId: number,
  region: { minX: number; minY: number; maxX: number; maxY: number },
  doorGapPx: number
): number[] {
  const minSeedClearance = Math.max(6, Math.round(3 * doorGapPx)); // chamfer units (3/px): pockets >= ~2 door gaps wide
  const candidates: { index: number; clearance: number }[] = [];
  const minY = Math.max(1, region.minY);
  const maxY = Math.min(height - 2, region.maxY);
  const minX = Math.max(1, region.minX);
  const maxX = Math.min(width - 2, region.maxX);
  for (let y = minY; y <= maxY; y += 1) {
    const rowBase = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const index = rowBase + x;
      if (regionMap[index] !== regionId) {
        continue;
      }
      const value = clearance[index];
      if (
        value < minSeedClearance ||
        clearance[index - 1] > value ||
        clearance[index + 1] > value ||
        clearance[index - width] > value ||
        clearance[index + width] > value
      ) {
        continue;
      }
      candidates.push({ index, clearance: value });
    }
  }

  candidates.sort((a, b) => b.clearance - a.clearance);
  const suppressionRadius = 5 * doorGapPx;
  const suppressionRadiusSq = suppressionRadius * suppressionRadius;
  const kept: number[] = [];
  const keptX: number[] = [];
  const keptY: number[] = [];
  const maxSeeds = 64;
  for (const candidate of candidates) {
    const x = candidate.index % width;
    const y = (candidate.index - x) / width;
    let suppressed = false;
    for (let k = 0; k < kept.length; k += 1) {
      const dx = x - keptX[k];
      const dy = y - keptY[k];
      if (dx * dx + dy * dy < suppressionRadiusSq) {
        suppressed = true;
        break;
      }
    }
    if (suppressed) {
      continue;
    }
    kept.push(candidate.index);
    keptX.push(x);
    keptY.push(y);
    if (kept.length >= maxSeeds) {
      break;
    }
  }
  return kept;
}

/**
 * Reassign one region's pixels to per-cluster region ids by clearance-ordered watershed
 * (hierarchical queue): growth floods open space first and reaches near-wall pixels
 * last, so the frontiers between clusters settle along low-clearance pinch lines —
 * the gaps between wall stubs — instead of label equidistance. On constant-clearance
 * plateaus (uniform corridors) FIFO order reproduces the equidistant split. Returns the
 * per-cluster pixel stats and, per adjacent sub-region pair, the frontier length and
 * the maximum clearance along it (how wide the widest shared passage is).
 */
function watershedSplitRegion(
  regionMap: Uint16Array,
  clearance: Int32Array,
  width: number,
  height: number,
  oldRegionId: number,
  clusters: SeedCluster[],
  newIds: number[]
): { fills: WatershedFill[]; frontiers: Map<number, { lengthPx: number; maxClearance: number }> } {
  const fills: WatershedFill[] = clusters.map(() => ({ pixelCount: 0, minX: width, minY: height, maxX: -1, maxY: -1 }));
  const idToCluster = new Map<number, number>();
  for (let clusterIndex = 0; clusterIndex < newIds.length; clusterIndex += 1) {
    idToCluster.set(newIds[clusterIndex], clusterIndex);
  }

  // Hierarchical FIFO bucket queue keyed by clearance. Spill rule: a neighbor is
  // enqueued at min(own clearance, current level) so growth through a pinch into a
  // wider basin continues at the pinch's level — the cursor is monotone descending
  // and every pixel is processed exactly once.
  const maxLevel = Math.min(0x3ffffffe, 3 * (width + height));
  const buckets: (number[] | undefined)[] = new Array(maxLevel + 1);
  const bucketHeads = new Int32Array(maxLevel + 1);
  const enqueue = (index: number, atLevel: number): void => {
    const key = Math.max(0, Math.min(clearance[index], atLevel));
    (buckets[key] ??= []).push(index);
  };

  let bboxMinX = width;
  let bboxMinY = height;
  let bboxMaxX = -1;
  let bboxMaxY = -1;
  const claim = (index: number, newId: number): void => {
    regionMap[index] = newId;
    const clusterIndex = idToCluster.get(newId) as number;
    const fill = fills[clusterIndex];
    const x = index % width;
    const y = (index - x) / width;
    fill.pixelCount += 1;
    fill.minX = Math.min(fill.minX, x);
    fill.maxX = Math.max(fill.maxX, x);
    fill.minY = Math.min(fill.minY, y);
    fill.maxY = Math.max(fill.maxY, y);
    bboxMinX = Math.min(bboxMinX, x);
    bboxMaxX = Math.max(bboxMaxX, x);
    bboxMinY = Math.min(bboxMinY, y);
    bboxMaxY = Math.max(bboxMaxY, y);
  };

  let level = 0;
  for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
    for (const probe of clusters[clusterIndex].probes) {
      if (regionMap[probe] === oldRegionId) {
        claim(probe, newIds[clusterIndex]);
        enqueue(probe, maxLevel);
        level = Math.max(level, Math.min(clearance[probe], maxLevel));
      }
    }
  }

  while (level >= 0) {
    const bucket = buckets[level];
    if (bucket === undefined || bucketHeads[level] >= bucket.length) {
      level -= 1;
      continue;
    }
    const index = bucket[bucketHeads[level]];
    bucketHeads[level] += 1;
    const newId = regionMap[index];
    const x = index % width;
    if (x > 0 && regionMap[index - 1] === oldRegionId) {
      claim(index - 1, newId);
      enqueue(index - 1, level);
    }
    if (x < width - 1 && regionMap[index + 1] === oldRegionId) {
      claim(index + 1, newId);
      enqueue(index + 1, level);
    }
    if (index >= width && regionMap[index - width] === oldRegionId) {
      claim(index - width, newId);
      enqueue(index - width, level);
    }
    if (index + width < regionMap.length && regionMap[index + width] === oldRegionId) {
      claim(index + width, newId);
      enqueue(index + width, level);
    }
  }

  // Frontier length and maximum clearance between adjacent sub-regions (cluster-index
  // pairs). The max clearance measures the widest passage the frontier crosses.
  const frontiers = new Map<number, { lengthPx: number; maxClearance: number }>();
  for (let y = Math.max(0, bboxMinY); y <= Math.min(height - 1, bboxMaxY); y += 1) {
    for (let x = Math.max(0, bboxMinX); x <= Math.min(width - 1, bboxMaxX); x += 1) {
      const index = y * width + x;
      const clusterA = idToCluster.get(regionMap[index]);
      if (clusterA === undefined) {
        continue;
      }
      for (const neighbor of [index + 1, index + width]) {
        if ((neighbor === index + 1 && x === width - 1) || neighbor >= regionMap.length) {
          continue;
        }
        const clusterB = idToCluster.get(regionMap[neighbor]);
        if (clusterB === undefined || clusterB === clusterA) {
          continue;
        }
        const key = clusterA < clusterB ? clusterA * 4096 + clusterB : clusterB * 4096 + clusterA;
        const pairClearance = Math.max(clearance[index], clearance[neighbor]);
        const entry = frontiers.get(key);
        if (entry) {
          entry.lengthPx += 1;
          entry.maxClearance = Math.max(entry.maxClearance, pairClearance);
        } else {
          frontiers.set(key, { lengthPx: 1, maxClearance: pairClearance });
        }
      }
    }
  }

  return { fills, frontiers };
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
