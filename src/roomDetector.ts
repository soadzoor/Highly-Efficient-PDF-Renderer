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
   * Area fraction used to identify page-frame/title-block interiors when a component
   * also spans almost the whole page. Large but genuinely enclosed rooms are retained.
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
   * Require every returned room to touch at least one plausible door opening. Disabled
   * by default because shafts, risers, service voids, and rooms whose door is omitted or
   * hidden by the PDF export are still valid enclosed spaces. Door evidence is always
   * reported on each result and contributes to confidence even when it is not required.
   *
   * @default false
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

  /**
   * Treat PDF zero-width/device-hairline strokes as wall candidates. Hairlines are
   * ignored by default because they commonly encode annotations and furniture; this
   * switch is primarily useful as an alternate hypothesis for CAD exports whose wall
   * faces were also written with a zero line width.
   *
   * @default false
   */
  includeHairlineStrokes?: boolean;

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
  /** Whether the enclosed region touches a context-checked door arc or bridged opening. */
  hasDoorEvidence: boolean;
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
  | "wallCavity"
  | "containsRoom"
  | "overlap";

export interface RoomSeedFailure {
  seed: RoomSeed;
  reason: RoomSeedFailureReason;
}

/** Per-page diagnostics and resolved adaptive thresholds. */
export interface RoomDetectionPageStats {
  pageIndex: number;
  eligibleSegmentCount: number;
  /** Visible zero-width/device-hairline segments present on the page. */
  hairlineSegmentCount: number;
  totalStrokeLength: number;
  /** Stroke half-width classes with the total stroke length drawn at each width. */
  widthHistogram: { halfWidth: number; totalLength: number; segmentCount: number }[];
  wallHalfWidthThreshold: number;
  /** Length-weighted median half-width of the accepted wall segments. */
  wallMedianHalfWidth: number;
  wallSegmentCount: number;
  /** True when stroke widths carried no signal and ink-density filtering was the fallback. */
  uniformWidthMode: boolean;
  /** Share of long straight-stroke length carried by the most common RGB cohort. */
  dominantLongStrokeColorFraction: number;
  /** Long-stroke length ratio between the largest and second-largest RGB cohorts. */
  dominantLongStrokeColorRatio: number;
  /** Rooms whose coarse geometry was replaced by a topology-safe structural-color trace. */
  structuralGeometryRefinementCount: number;
  /** Leaked open zones reconstructed from three dominant-color wall sides and one semantic frontier. */
  openBayRefinementCount: number;
  /** Oversized door gaps recovered from paired wall-face tracks and a validated swing arc. */
  pairedDoorRecoveryCount: number;
  doorGapMax: number;
  /** Tight-curve subsegments considered as door-swing evidence before context checks. */
  doorArcCandidateSegmentCount: number;
  /** Candidate door-arc subsegments retained after open-chain and wall-context checks. */
  doorArcSegmentCount: number;
  /** Number of virtual closure segments bridging door openings and wall gaps. */
  closureCount: number;
  /** Candidate outer polygons removed because they contained another detected room. */
  containedRoomSuppressionCount: number;
  /** Candidate polygons moved to conservative contour geometry before final suppression. */
  geometryRepairCount: number;
  /** Rooms removed only after every valid non-overlapping geometry fallback was exhausted. */
  geometryConflictSuppressionCount: number;
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
  /** Admit zero-width/device-hairline strokes using a page-relative nominal width. */
  includeHairlineStrokes: boolean;
  /** Internal hypothesis: admit strokes only from the dominant long-line RGB cohort. */
  dominantColorWallsOnly: boolean;
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
/** Alternate architectural door scale for uniformly thin, text-labeled CAD plans. */
const UNIFORM_WIDTH_DOOR_GAP_FLOOR_FACTOR = 0.0105;
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
 * const pdfObject = await pdfObjectGenerator(file, { extractText: true });
 * const result = detectRooms(pdfObject.sceneData);
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
    requireDoor: options.requireDoor === true,
    minWallComponentFactor:
      options.minWallComponentFactor !== undefined && Number.isFinite(options.minWallComponentFactor) && options.minWallComponentFactor >= 0
        ? options.minWallComponentFactor
        : 2.5,
    splitByLabels: options.splitByLabels !== false,
    splitUnlabeledRegions: options.splitUnlabeledRegions === true,
    includeHairlineStrokes: options.includeHairlineStrokes === true,
    dominantColorWallsOnly: false,
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
    /** Paired structural tracks retained for post-selection topology-safe refinement. */
    pairedStructuralWalls: number[];
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
      debugClosures: [],
      pairedStructuralWalls: []
    };
    attempt.stats = detectRoomsOnPage(
      scene,
      pageIndex,
      pageOptions,
      providedSeeds,
      attempt.rooms,
      attempt.failedSeeds,
      attempt.debug,
      attempt.debugWalls,
      attempt.debugClosures,
      attempt.pairedStructuralWalls
    );
    return attempt;
  };

  // Seeds that landed inside an accepted room. Derive this from the attempt total so
  // caller-provided seeds (which intentionally do not become SceneTextItem labels) count
  // as well. This stays invariant to region splitting/merging.
  const explainedSeeds = (attempt: PageAttempt): number =>
    Math.max(0, (attempt.stats?.seedCount ?? 0) - attempt.failedSeeds.length);

  // Label-free attempt quality: area-weighted rectangularity of plausible rooms.
  // Correctly carved rooms are mostly rectangular (area close to their bounding box);
  // furniture fragmentation produces jagged low-rectangularity pockets, while unbridged
  // door openings can merge most of the floor into one dominant component. A soft
  // concentration penalty fixes that second failure without rewarding raw room count.
  const geometricScore = (attempt: PageAttempt, minPlausibleArea: number): number => {
    let rectangularityScore = 0;
    let totalArea = 0;
    let largestArea = 0;
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
      rectangularityScore += room.area * rectangularity * rectangularity;
      totalArea += room.area;
      largestArea = Math.max(largestArea, room.area);
    }
    if (!(totalArea > 0)) {
      return 0;
    }
    const dominantShare = largestArea / totalArea;
    const concentrationPenalty = 0.5 * totalArea * Math.max(0, dominantShare - 0.5);
    return rectangularityScore - concentrationPenalty;
  };

  /**
   * Use an independently traced structural-color room only as a conservative geometry
   * refinement. The primary attempt still decides which rooms exist: a replacement must
   * contain exactly one primary room anchor, substantially simplify its outline, stay
   * close in area, and remain disjoint from every other accepted room.
   */
  const refineWithStructuralGeometry = (primary: PageAttempt, structural: PageAttempt): void => {
    if (primary.rooms.length === 0 || structural.rooms.length === 0) {
      return;
    }
    const epsilon = 1e-9;
    for (let roomIndex = 0; roomIndex < primary.rooms.length; roomIndex += 1) {
      const room = primary.rooms[roomIndex];
      const roomVertexCount = room.polygon.length / 2;
      let best: DetectedRoom | null = null;
      let bestIsLabelOwnedTrim = false;
      let bestVertexCount = Number.POSITIVE_INFINITY;

      for (const candidate of structural.rooms) {
        if (!pointInPolygon(room.labelX, room.labelY, candidate.polygon)) {
          continue;
        }
        if (room.roomNumber && candidate.roomNumber && room.roomNumber !== candidate.roomNumber) {
          continue;
        }
        let containedPrimaryAnchors = 0;
        for (const other of primary.rooms) {
          if (pointInPolygon(other.labelX, other.labelY, candidate.polygon)) {
            containedPrimaryAnchors += 1;
          }
        }
        if (containedPrimaryAnchors !== 1) {
          continue;
        }

        const candidatePolygon = new Float32Array(candidate.polygon);
        const candidateSignedArea = signedPolygonArea(candidatePolygon);
        if (!(candidateSignedArea > 0) || !isSimplePolygon(candidatePolygon, epsilon)) {
          continue;
        }
        const candidateVertexCount = candidate.polygon.length / 2;
        const decisiveSimplification =
          candidateVertexCount <= roomVertexCount - 2 &&
          candidateVertexCount <= Math.max(8, Math.ceil(roomVertexCount * 0.75));
        const areaRatio = candidateSignedArea / Math.max(room.area, 1e-9);
        // A structural-color trace may also remove a large equipment/neighbor-room
        // excursion, not merely smooth a close contour. Admit that wider correction
        // only when both attempts agree on a real room number, every architectural-
        // scale primary label is retained, and the structural outline is decisively
        // simpler. These gates keep
        // an independently traced shaft, label frame, or partial furniture pocket from
        // replacing a valid room simply because it is smaller.
        const numberedLabel = room.labels.find((label) =>
          labelContainsRoomNumber(label.text, room.roomNumber)
        );
        const numberedLabelScale = numberedLabel
          ? Math.min(numberedLabel.maxX - numberedLabel.minX, numberedLabel.maxY - numberedLabel.minY)
          : 0;
        const retainsArchitecturalLabels =
          numberedLabelScale > 0 &&
          room.labels.every((label) => {
            const labelScale = Math.min(label.maxX - label.minX, label.maxY - label.minY);
            // Small equipment/fixture tags can sit inside the erroneous excursion.
            // The independently traced cell may discard those, but it must retain the
            // room number and every label set at the architectural label scale.
            return (
              labelScale < 0.85 * numberedLabelScale ||
              pointInPolygon((label.minX + label.maxX) / 2, (label.minY + label.maxY) / 2, candidatePolygon)
            );
          });
        const decisiveLabelOwnedTrim =
          areaRatio >= 0.65 &&
          areaRatio < 0.97 &&
          room.roomNumber.length > 0 &&
          candidate.roomNumber === room.roomNumber &&
          candidateVertexCount <= roomVertexCount - 4 &&
          candidateVertexCount <= Math.max(6, Math.floor(roomVertexCount * 0.6)) &&
          room.labels.length > 0 &&
          retainsArchitecturalLabels &&
          candidate.labels.some((label) => labelContainsRoomNumber(label.text, room.roomNumber));
        if ((areaRatio < 0.97 || areaRatio > 1.25) && !decisiveLabelOwnedTrim) {
          continue;
        }
        if (!decisiveSimplification || candidateVertexCount >= bestVertexCount) {
          continue;
        }

        const candidateBounds = polygonBounds(candidatePolygon);
        let overlapsAnotherRoom = false;
        for (let otherIndex = 0; otherIndex < primary.rooms.length; otherIndex += 1) {
          if (otherIndex === roomIndex) {
            continue;
          }
          const other = primary.rooms[otherIndex];
          const otherBounds = polygonBounds(other.polygon);
          if (
            boundsHaveInteriorIntersection(candidateBounds, otherBounds, epsilon) &&
            polygonsHavePositiveAreaOverlap(candidatePolygon, other.polygon, candidateBounds, otherBounds, epsilon)
          ) {
            overlapsAnotherRoom = true;
            break;
          }
        }
        if (!overlapsAnotherRoom) {
          best = candidate;
          bestIsLabelOwnedTrim = decisiveLabelOwnedTrim;
          bestVertexCount = candidateVertexCount;
        }
      }

      if (best) {
        room.polygon = new Float32Array(best.polygon);
        room.area = Math.abs(signedPolygonArea(room.polygon));
        if (bestIsLabelOwnedTrim) {
          // Geometry and label ownership agree in the structural attempt. Drop only
          // the small fixture/equipment tags that occupied the rejected excursion;
          // keep the primary attempt's access/confidence evidence.
          room.labelText = best.labelText;
          room.roomNumber = best.roomNumber;
          room.labelX = best.labelX;
          room.labelY = best.labelY;
          room.labels = [...best.labels];
        }
        if (primary.stats) {
          primary.stats.structuralGeometryRefinementCount += 1;
        }
      }
    }
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

      const labelSeedCount = attempt.stats?.seedCount ?? 0;
      const leakedCount = (candidate: PageAttempt): number =>
        candidate.failedSeeds.filter((failure) => failure.reason === "leaked" || failure.reason === "noWalls").length;
      const firstWasUniform = attempt.stats?.uniformWidthMode === true;
      const massLeak = labelSeedCount >= 10 && leakedCount(attempt) / labelSeedCount > 0.45;
      const hasLabels = labelSeedCount >= 10;
      const poorSeedCoverage = hasLabels && attempt.failedSeeds.length / labelSeedCount > 0.45;

      if (firstWasUniform || massLeak || !hasLabels) {
        const candidates: PageAttempt[] = [runPage(pageIndex, { ...resolved, wallHalfWidthThreshold: 1e-9, allowDensityFilter: false })];
        if (firstWasUniform && hasLabels && resolved.doorGapFloorFactor < UNIFORM_WIDTH_DOOR_GAP_FLOOR_FACTOR) {
          // Some hairline-only CAD exports encode walls and furniture with one pen
          // width. Density filtering separates them, but the default page-relative
          // door scale can be too short to seal the real openings. Try a larger
          // architectural scale and let label coverage reject it on plans where it
          // merges rooms or raises the cavity threshold too far.
          candidates.push(
            runPage(pageIndex, {
              ...resolved,
              doorGapFloorFactor: UNIFORM_WIDTH_DOOR_GAP_FLOOR_FACTOR
            })
          );
        }
        if (!firstWasUniform) {
          candidates.push(runPage(pageIndex, { ...resolved, wallHalfWidthThreshold: 1e-9, allowDensityFilter: true }));
          // Thick walls plus long straight strokes of any width: catches plans whose
          // partition/glass walls are drawn thin while furniture stays short-stroked.
          candidates.push(runPage(pageIndex, { ...resolved, longWallHalfWidthMinFactor: 0 }));
        }
        const omittedHairlines = attempt.stats?.hairlineSegmentCount ?? 0;
        const eligibleSegments = attempt.stats?.eligibleSegmentCount ?? 0;
        if (
          poorSeedCoverage &&
          !resolved.includeHairlineStrokes &&
          omittedHairlines >= Math.max(64, 0.03 * eligibleSegments)
        ) {
          const hairlineCandidate = runPage(pageIndex, {
            ...resolved,
            includeHairlineStrokes: true,
            wallDetectionMode: "doubleLine",
            allowDensityFilter: false
          });
          // Device hairlines often draw furniture and annotations, so only paired
          // wall faces are admitted and the hypothesis must recover a decisive amount
          // of labeled floor area. Marginal gains are too easy to manufacture with
          // symbol pockets.
          if (explainedSeeds(hairlineCandidate) > explainedSeeds(attempt) * 1.2) {
            candidates.push(hairlineCandidate);
          }
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

        const colorStructureIsDecisive =
          (attempt.stats?.dominantLongStrokeColorFraction ?? 0) >= 0.5 &&
          (attempt.stats?.dominantLongStrokeColorRatio ?? 0) >= 3;
        if (firstWasUniform && hasLabels && colorStructureIsDecisive) {
          const structuralAttempt = runPage(pageIndex, {
            ...resolved,
            wallHalfWidthThreshold: 1e-9,
            doorGapFloorFactor: Math.max(resolved.doorGapFloorFactor, UNIFORM_WIDTH_DOOR_GAP_FLOOR_FACTOR),
            allowDensityFilter: false,
            dominantColorWallsOnly: true
          });
          refineWithStructuralGeometry(attempt, structuralAttempt);
          // A structural trim can remove the only neighboring overlap that correctly
          // blocked an outward wall-envelope recovery inside the page attempt. Retry
          // the same strict repair after that trim; its anchor/overlap gates remain
          // unchanged, and already-repaired four-vertex rooms are naturally skipped.
          if (attempt.stats && attempt.pairedStructuralWalls.length > 0) {
            attempt.stats.geometryRepairCount += repairPairedWallRectangularEnvelope(
              attempt.rooms,
              attempt.pairedStructuralWalls,
              attempt.stats.doorGapMax
            );
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
  debugClosures: number[],
  pairedStructuralWallsOut: number[]
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
    hairlineSegmentCount: stageA.hairlineSegmentCount,
    totalStrokeLength: stageA.totalStrokeLength,
    widthHistogram: stageA.widthHistogram,
    wallHalfWidthThreshold: stageA.wallHalfWidthThreshold,
    wallMedianHalfWidth: stageA.wallMedianHalfWidth,
    wallSegmentCount: stageA.walls.length / WALL_STRIDE,
    uniformWidthMode: stageA.uniformWidthMode,
    dominantLongStrokeColorFraction: stageA.dominantLongStrokeColorFraction,
    dominantLongStrokeColorRatio: stageA.dominantLongStrokeColorRatio,
    structuralGeometryRefinementCount: 0,
    openBayRefinementCount: 0,
    pairedDoorRecoveryCount: 0,
    doorGapMax: 0,
    doorArcCandidateSegmentCount: stageA.doorArcs.length / WALL_STRIDE,
    doorArcSegmentCount: 0,
    closureCount: 0,
    containedRoomSuppressionCount: 0,
    geometryRepairCount: 0,
    geometryConflictSuppressionCount: 0,
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
  // Keep the architectural door scale used by room-size/thickness filters conservative,
  // but let structural closures search farther. CAD plans often stop a partition at the
  // far door jamb or opposite wall face, so the free run measured by the whisker is
  // longer than the nominal clear opening. Coupling this reach to `doorGapMax` made the
  // only way to seal those rooms also raise every cavity/minimum-size threshold.
  const closureGapMax = Math.min(
    (options.wallDetectionMode === "doubleLine" ? 1.2 : 1.5) * doorGapMax,
    (options.wallDetectionMode === "doubleLine" ? 0.015 : 0.035) * pageDiagonal
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
    const longWalls = stageA.walls;
    const longWallCount = longWalls.length / WALL_STRIDE;
    for (let i = 0; i < longWallCount; i += 1) {
      const base = i * WALL_STRIDE;
      const length = Math.hypot(longWalls[base + 2] - longWalls[base], longWalls[base + 3] - longWalls[base + 1]);
      if (length >= longKeepLength) {
        stampSegment(
          occupancy,
          rasterWidth,
          rasterHeight,
          worldToRasterX(longWalls[base]),
          worldToRasterY(longWalls[base + 1]),
          worldToRasterX(longWalls[base + 2]),
          worldToRasterY(longWalls[base + 3]),
          Math.max(longWalls[base + 4] * scale, 0.875)
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
  // Closures are tracked separately from structural occupancy so access evidence can
  // rank/filter rooms without defining their geometry. Tight curves are merely door
  // candidates: keep only open arc chains attached to the wall network. Closed circles
  // and isolated curved fixtures must never make a sealed enclosure look accessible.
  const closureMask = new Uint8Array(rasterWidth * rasterHeight);
  const pairedStructuralWalls =
    stageA.uniformWidthMode &&
    options.allowDensityFilter &&
    options.wallDetectionMode !== "doubleLine" &&
    stageA.rawSegments
      ? buildDoubleLineWalls(
        stageA.rawSegments,
        pageMinX,
        pageMinY,
        pageMaxX,
        pageMaxY,
        pageDiagonal,
        stageA.wallMedianHalfWidth,
        0.01 * pageDiagonal,
        false,
        0.004,
        true
      )
      : [];
  pairedStructuralWallsOut.push(...pairedStructuralWalls);
  const contextualDoorArcs = filterDoorArcComponents(stageA.doorArcs, walls, grid, wallWidth, closureGapMax);
  let pairedDoorArcs: Float64Array = new Float64Array(0);
  if (pairedStructuralWalls.length > 0 && stageA.broadDoorArcs.length > 0) {
    const pairedWallArray = new Float64Array(pairedStructuralWalls);
    const pairedGrid = new WallGrid(
      pairedWallArray,
      pairedWallArray.length / WALL_STRIDE,
      pageMinX,
      pageMinY,
      pageMaxX,
      pageMaxY,
      Math.max(doorGapMax, wallWidth * 4)
    );
    pairedDoorArcs = filterDoorArcComponents(
      stageA.broadDoorArcs,
      pairedWallArray,
      pairedGrid,
      wallWidth,
      closureGapMax
    );
  }
  const labelBackedPairedRecovery = buildLabelBackedPairedPartitionRecovery(
    pairedStructuralWalls,
    pairedDoorArcs,
    seeds,
    occupancy,
    rasterWidth,
    rasterHeight,
    worldToRasterX,
    worldToRasterY,
    scale,
    doorGapMax
  );
  stats.doorArcSegmentCount = contextualDoorArcs.length / WALL_STRIDE;
  for (let i = 0; i + 4 < contextualDoorArcs.length + 1; i += WALL_STRIDE) {
    stampSegment(
      closureMask,
      rasterWidth,
      rasterHeight,
      worldToRasterX(contextualDoorArcs[i]),
      worldToRasterY(contextualDoorArcs[i + 1]),
      worldToRasterX(contextualDoorArcs[i + 2]),
      worldToRasterY(contextualDoorArcs[i + 3]),
      Math.max(contextualDoorArcs[i + 4] * scale, 0.875)
    );
  }
  const pairedDoorRecovery =
    stageA.uniformWidthMode &&
    options.allowDensityFilter &&
    options.wallDetectionMode !== "doubleLine" &&
    pairedStructuralWalls.length > 0 &&
    pairedDoorArcs.length > 0
      ? buildPairedTrackDoorRecovery(
        pairedStructuralWalls,
        pairedDoorArcs,
        doorGapMax,
        closureGapMax
      )
      : { walls: [], closures: [] };
  pairedDoorRecovery.walls.push(...labelBackedPairedRecovery.walls);
  pairedDoorRecovery.closures.push(...labelBackedPairedRecovery.closures);
  stats.pairedDoorRecoveryCount = pairedDoorRecovery.closures.length / WALL_STRIDE;
  for (let i = 0; i + 4 < pairedDoorRecovery.walls.length; i += WALL_STRIDE) {
    stampSegment(
      occupancy,
      rasterWidth,
      rasterHeight,
      worldToRasterX(pairedDoorRecovery.walls[i]),
      worldToRasterY(pairedDoorRecovery.walls[i + 1]),
      worldToRasterX(pairedDoorRecovery.walls[i + 2]),
      worldToRasterY(pairedDoorRecovery.walls[i + 3]),
      Math.max(pairedDoorRecovery.walls[i + 4] * scale, 0.875)
    );
    if (debug) {
      debugWallSegments.push(
        pairedDoorRecovery.walls[i],
        pairedDoorRecovery.walls[i + 1],
        pairedDoorRecovery.walls[i + 2],
        pairedDoorRecovery.walls[i + 3]
      );
    }
  }
  const closures = buildWhiskerClosures(
    walls,
    wallCount,
    grid,
    wallWidth,
    maxWallHalfWidth,
    doorGapMax,
    closureGapMax,
    contextualDoorArcs,
    {
      occupancy,
      width: rasterWidth,
      height: rasterHeight,
      scale,
      worldToRasterX,
      worldToRasterY
    }
  );
  closures.push(...pairedDoorRecovery.closures);
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
  const structuralHairlineClose = options.includeHairlineStrokes && options.wallDetectionMode === "doubleLine";
  morphologicalClose(
    occupancy,
    rasterWidth,
    rasterHeight,
    Math.min(Math.max(1.5 * wallWidth * scale, structuralHairlineClose ? 4.5 : 2.5), 0.35 * doorGapMax * scale, 12)
  );

  // Stage D: flood fill from each seed.
  const regionMap = new Uint16Array(rasterWidth * rasterHeight);
  const maxRegionPixels = Math.max(options.minRoomAreaPixels, Math.floor(options.maxRoomAreaFraction * rasterWidth * rasterHeight));

  // Pre-fill everything reachable from the page border as "exterior", so leaking seeds
  // fail immediately instead of flooding (and possibly truncating at) huge areas.
  for (let x = 0; x < rasterWidth; x += 1) {
    for (const index of [x, (rasterHeight - 1) * rasterWidth + x]) {
      if (occupancy[index] === 0 && regionMap[index] === 0) {
        floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, index, EXTERIOR_REGION_ID, -1);
      }
    }
  }
  for (let y = 0; y < rasterHeight; y += 1) {
    for (const index of [y * rasterWidth, y * rasterWidth + rasterWidth - 1]) {
      if (occupancy[index] === 0 && regionMap[index] === 0) {
        floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, index, EXTERIOR_REGION_ID, -1);
      }
    }
  }
  interface RegionRecord {
    failure: RoomSeedFailureReason | null;
    roomIndex: number;
    auto: boolean;
    /** Region was partitioned by a watershed and shares a synthetic frontier. */
    syntheticSplit?: boolean;
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
    const fill = floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, probe, regionId, EXTERIOR_REGION_ID, closureMask);
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

    if (fill.touchedBorder) {
      region.failure = "leaked";
    } else if (fill.pixelCount < options.minRoomAreaPixels) {
      region.failure = "tooSmall";
    }
    if (region.failure) {
      failedSeeds.push({ seed: seed.asRoomSeed, reason: region.failure });
    }
  }

  // Resolve the optional hard door requirement only after every seed in a component has
  // been collected. Otherwise a dimension encountered before a valid room/shaft label
  // makes acceptance depend on PDF text order.
  if (options.requireDoor) {
    for (const region of regions) {
      if (region.failure || region.touchesDoor) {
        continue;
      }
      const labelOverridesDoor = region.seeds.some((regionSeed) => {
        const item = regionSeed.item;
        if (!item || !isRoomLikeLabel(regionSeed.label)) {
          return false;
        }
        const labelAreaPx = Math.max(1, (item.maxX - item.minX) * (item.maxY - item.minY) * scale * scale);
        return region.pixelCount >= 6 * labelAreaPx;
      });
      if (!labelOverridesDoor) {
        region.failure = "noDoor";
        for (const regionSeed of region.seeds) {
          failedSeeds.push({ seed: regionSeed.asRoomSeed, reason: "noDoor" });
        }
      }
    }
  }

  // Unlabeled rooms: visit every remaining free-space component. Each flood fill paints
  // its entire component, including components that exceed the room-area limit, so the
  // linear scan starts exactly one fill per component and cannot miss a room because a
  // coarse sampling grid happened not to land inside it. Thin or tiny regions (hollow
  // wall bands, junction pockets) are rejected after contour tracing.
  const autoMinAreaPixels = Math.max(options.minRoomAreaPixels, Math.round((doorGapMax * scale) ** 2));
  const autoMinThicknessPx = Math.max(3, 2.5 * wallWidth * scale, 0.25 * doorGapMax * scale);
  if (options.detectUnlabeledRooms) {
    for (let index = 0; index < regionMap.length && nextRegionId < EXTERIOR_REGION_ID; index += 1) {
      if (occupancy[index] !== 0 || regionMap[index] !== 0) {
        continue;
      }
      const regionId = nextRegionId;
      nextRegionId += 1;
      const fill = floodFillRegion(occupancy, regionMap, rasterWidth, rasterHeight, index, regionId, EXTERIOR_REGION_ID, closureMask);
      regions.push({
        failure: fill.touchedBorder
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
      // A rejected watershed child must not leave a hole in a surviving room. This is
      // especially important for equipment tags: several annotation-like labels can
      // seed a tiny furniture-shaped cell whose pixel frontier would otherwise become
      // a visible, non-architectural room edge. Absorb every undersized group into the
      // adjacent group with which it shares the longest frontier before repainting.
      const absorbedClusters = mergeUndersizedWatershedGroups(
        groupOf,
        fills,
        frontiers,
        options.minRoomAreaPixels
      );

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
          // Absorption repairs geometry only. A tiny rejected equipment/tag cell must
          // not become the surviving room's primary metadata merely because its pixels
          // were returned to that room. This also preserves the pre-repair label
          // behavior while removing the artificial hole/frontier.
          if (absorbedClusters[member] === 0) {
            seeds.push(...roomClusters[member].seeds);
            probes.push(...roomClusters[member].probes);
          }
        }
        regions.push({
          failure: fill.pixelCount < options.minRoomAreaPixels ? "tooSmall" : null,
          roomIndex: -1,
          auto: false,
          syntheticSplit: true,
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
      mergeUndersizedWatershedGroups(groupOf, fills, frontiers, autoMinAreaPixels);
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
          syntheticSplit: true,
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
  const roomRasterContours: number[][] = [];
  const roomMemberPixels: number[] = [];
  const roomPreOffsetPolygons: Float32Array[] = [];
  const roomRawPolygons: Float32Array[] = [];
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

    // A DetectedRoom currently carries one simple outer ring. Reject components whose
    // pixels occupy little of that ring on every discovery path, not only the unlabeled
    // path; otherwise a text seed inside sheet background or a wall-network cavity can
    // turn a hole-riddled component into a huge polygon that covers the whole drawing.
    let contourPerimeter = 0;
    let contourMinX = Infinity;
    let contourMinY = Infinity;
    let contourMaxX = -Infinity;
    let contourMaxY = -Infinity;
    for (let i = 0; i + 1 < contour.length; i += 2) {
      const nextIndex = (i + 2) % contour.length;
      contourPerimeter += Math.abs(contour[nextIndex] - contour[i]) + Math.abs(contour[nextIndex + 1] - contour[i + 1]);
      contourMinX = Math.min(contourMinX, contour[i]);
      contourMinY = Math.min(contourMinY, contour[i + 1]);
      contourMaxX = Math.max(contourMaxX, contour[i]);
      contourMaxY = Math.max(contourMaxY, contour[i + 1]);
    }
    const contourAreaPixels = Math.max(1, Math.abs(signedPolygonArea(contour)));
    const rasterSolidity = region.pixelCount / contourAreaPixels;
    if (rasterSolidity < 0.55) {
      region.failure = "wallCavity";
      for (const seed of region.seeds) {
        failedSeeds.push({ seed: seed.asRoomSeed, reason: "wallCavity" });
      }
      continue;
    }

    // Sheet borders and title blocks can form a closed component even though they are
    // not architectural space. Unlike a warehouse-sized room, that component spans a
    // near-page edge pair and contains substantial holes/linework. Keep the old area
    // option only as the trigger for this page-frame test, never as a hard room-size cap.
    const frameMargin = 0.06 * Math.min(rasterWidth, rasterHeight);
    const spansMostWidth = contourMaxX - contourMinX >= 0.75 * rasterWidth;
    const spansMostHeight = contourMaxY - contourMinY >= 0.75 * rasterHeight;
    const nearHorizontalFrame = contourMinX <= frameMargin && contourMaxX >= rasterWidth - frameMargin;
    const nearVerticalFrame = contourMinY <= frameMargin && contourMaxY >= rasterHeight - frameMargin;
    if (
      region.pixelCount > maxRegionPixels &&
      spansMostWidth &&
      spansMostHeight &&
      (nearHorizontalFrame || nearVerticalFrame) &&
      rasterSolidity < 0.92
    ) {
      region.failure = "tooLarge";
      for (const seed of region.seeds) {
        failedSeeds.push({ seed: seed.asRoomSeed, reason: "tooLarge" });
      }
      continue;
    }

    if (region.auto) {
      // Reject genuinely thin unlabeled slivers while preserving compact sealed spaces
      // such as shafts and risers. Text must not be required to discover their geometry.
      const meanThickness = region.pixelCount / Math.max(1, contourPerimeter / 2);
      if (meanThickness < autoMinThicknessPx) {
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

    let preOffsetArea = signedPolygonArea(finalPolygon);
    let preOffsetOriented = finalPolygon;
    if (preOffsetArea < 0) {
      preOffsetOriented = reversePolygon(finalPolygon);
      preOffsetArea = -preOffsetArea;
    }

    let oriented = preOffsetOriented;
    let area = preOffsetArea;

    // Rasterized contours run along the edges of the round-capped wall stamps, which
    // erode roughly one raster pixel from every room; nudging the final polygon back
    // out recovers it (measured against the pdf-tsv ground truth).
    // Watershed children meet along a shared synthetic frontier. Expanding both sides
    // makes them overlap and forces topology repair back to the exact pixel staircase.
    // Keep those cells on their already-disjoint pre-offset geometry.
    const boundaryOffset = region.syntheticSplit ? 0 : options.boundaryOffsetFactor * pageDiagonal;
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

    // Room-number bubbles and equipment tags are often enclosed by their own small
    // rectangular annotation frame. A single compact alphanumeric tag inside a
    // door-less, sub-room-sized pocket describes the nearby room; it is not itself a
    // room. Door evidence cannot exempt a numeric frame: nearby arcs/closures can touch
    // the tiny component by accident. Text such as "SHAFT" is deliberately unaffected.
    const compactTagFrame =
      labels.length === 1 &&
      area < (2 * doorGapMax) ** 2 &&
      /\d/.test(labels[0].text) &&
      /^[A-Za-z0-9./-]{1,12}$/.test(labels[0].text.trim());
    if (compactTagFrame) {
      region.failure = "tooSmall";
      for (const seed of region.seeds) {
        failedSeeds.push({ seed: seed.asRoomSeed, reason: "tooSmall" });
      }
      continue;
    }

    // Closed title-block cells can be room-sized and contain uppercase text, but their
    // labels explicitly describe sheets/views rather than spaces. Require all labels to
    // be sheet annotations and no access evidence so a real room containing an incidental
    // detail reference is not removed.
    if (!region.touchesDoor && labels.length > 0 && labels.every((item) => isSheetAnnotationLabel(item.text))) {
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

    // The mean-thickness gate misses composites: the interiors of double-line walls
    // form one connected snaking network, and a single attached room-sized pocket
    // raises the composite's mean above the cavity limit. Pixel-level test instead:
    // a region that is cavity-thin across most of its pixels is a wall network no
    // matter what hangs off it.
    {
      const regionId = regionIndex + 1;
      clearance ??= buildClearanceField(occupancy, rasterWidth, rasterHeight);
      const thinLimit = 0.825 * doorGapMax * scale; // chamfer units: local width < 0.55 door gaps
      let regionPixels = 0;
      let thinPixels = 0;
      const scanMinX = Math.max(0, region.minX);
      const scanMaxX = Math.min(rasterWidth - 1, region.maxX);
      for (let y = Math.max(0, region.minY); y <= Math.min(rasterHeight - 1, region.maxY); y += 1) {
        const rowBase = y * rasterWidth;
        for (let x = scanMinX; x <= scanMaxX; x += 1) {
          if (regionMap[rowBase + x] !== regionId) {
            continue;
          }
          regionPixels += 1;
          if (clearance[rowBase + x] < thinLimit) {
            thinPixels += 1;
          }
        }
      }
      const thinFraction = regionPixels > 0 ? thinPixels / regionPixels : 0;
      if (thinFraction > (roomLikeLabeled ? 0.85 : 0.65)) {
        region.failure = "wallCavity";
        for (const seed of region.seeds) {
          failedSeeds.push({ seed: seed.asRoomSeed, reason: "wallCavity" });
        }
        continue;
      }
    }

    const bboxFill = area / Math.max(1e-9, (roomMaxX - roomMinX) * (roomMaxY - roomMinY));
    const thicknessScore = Math.min(1, meanThickness / (1.2 * doorGapMax));
    const geometryOnlyConfidence = 0.35 * thicknessScore + 0.25 * bboxFill;
    const hasRoomLabelEvidence = roomLikeLabeled || region.seeds.some((seed) => isRoomLikeLabel(seed.label));
    const minRoomSpan = Math.min(roomMaxX - roomMinX, roomMaxY - roomMinY);
    const sealedShaftGeometry =
      bboxFill >= 0.9 &&
      minRoomSpan >= doorGapMax &&
      area >= 3 * doorGapMax * doorGapMax;
    const substantialEnclosureGeometry =
      area >= (6 * doorGapMax) ** 2 &&
      meanThickness >= doorGapMax &&
      rasterSolidity >= 0.75;
    const confidence = Math.max(
      0,
      Math.min(
        1,
        geometryOnlyConfidence +
          (roomLikeLabeled ? 0.2 : 0) +
          (labels.length > 0 ? 0.1 : 0) +
          (region.touchesDoor ? 0.1 : 0)
      )
    );

    // Door-less geometry is intentionally allowed for shafts and incomplete exports,
    // but weak label-free pockets are overwhelmingly furniture, hatches, or symbol
    // interiors. Preserve text-backed spaces and only admit a geometry-only sealed
    // candidate when its thickness and rectangular fill jointly provide strong evidence.
    if (
      !region.touchesDoor &&
      !hasRoomLabelEvidence &&
      geometryOnlyConfidence < 0.56 &&
      !sealedShaftGeometry &&
      !substantialEnclosureGeometry
    ) {
      region.failure = "noDoor";
      for (const seed of region.seeds) {
        failedSeeds.push({ seed: seed.asRoomSeed, reason: "noDoor" });
      }
      continue;
    }

    const labelTexts = labels.length > 0 ? labels.map((item) => item.text.trim()) : region.seeds.map((seed) => seed.label).filter((label) => label.length > 0);
    const roomNumber = pickRoomNumber(labelTexts, labels);
    // PDF text order and geometric Y order frequently put an equipment tag before the
    // architectural room marker. Prefer the exact room-number token so downstream
    // structural matching and open-zone reconstruction start from the intended space.
    const primaryLabel = labels.find((item) => labelContainsRoomNumber(item.text, roomNumber)) ?? labels[0] ?? null;
    const primarySeed = region.seeds.find((seed) => labelContainsRoomNumber(seed.label, roomNumber)) ?? region.seeds[0] ?? null;
    const anchor = primaryLabel
      ? { x: (primaryLabel.minX + primaryLabel.maxX) / 2, y: (primaryLabel.minY + primaryLabel.maxY) / 2 }
      : primarySeed
        ? { x: primarySeed.x, y: primarySeed.y }
        : polygonCentroid(oriented);

    region.roomIndex = rooms.length;
    roomRasterContours.push(contour);
    roomMemberPixels.push(findRegionMemberPixel(regionMap, rasterWidth, rasterHeight, regionId, region));
    roomPreOffsetPolygons.push(new Float32Array(preOffsetOriented));

    // The exact raster outline is the conservative geometry fallback. Unlike wall-face
    // snapping, Douglas-Peucker shortcuts, and outward offsets, this transform preserves
    // the disjoint connected-component topology by construction.
    let rawWorldPolygon: Float64Array = new Float64Array(contour.length);
    for (let i = 0; i + 1 < contour.length; i += 2) {
      rawWorldPolygon[i] = rasterToWorldX(contour[i]);
      rawWorldPolygon[i + 1] = rasterToWorldY(contour[i + 1]);
    }
    if (signedPolygonArea(rawWorldPolygon) < 0) {
      rawWorldPolygon = reversePolygon(rawWorldPolygon);
    }
    roomRawPolygons.push(new Float32Array(rawWorldPolygon));
    rooms.push({
      pageIndex,
      polygon: new Float32Array(oriented),
      area,
      labelText: labelTexts.join("\n"),
      roomNumber,
      confidence,
      hasDoorEvidence: region.touchesDoor,
      labelX: anchor.x,
      labelY: anchor.y,
      labels
    });
  }

  // Final topology invariant: rooms are mutually exclusive cells. The raster regions
  // themselves are disjoint, but tracing only an outer ring can turn a hole-riddled
  // region into a "super room" that geometrically contains its inner rooms; snapping,
  // simplification, and boundary offsets can also create material overlaps. Suppress
  // those conflicts before the attempt is scored or exposed to callers.
  const suppressedRooms = findRoomConflictSuppressions(rooms, roomRasterContours, roomMemberPixels, rasterWidth);
  if (suppressedRooms.size > 0) {
    const oldToNew = new Int32Array(rooms.length);
    oldToNew.fill(-1);
    const keptRooms: DetectedRoom[] = [];
    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
      const reason = suppressedRooms.get(roomIndex);
      if (reason) {
        stats.containedRoomSuppressionCount += 1;
        continue;
      }
      oldToNew[roomIndex] = keptRooms.length;
      keptRooms.push(rooms[roomIndex]);
    }

    for (const region of regions) {
      if (region.roomIndex < 0) {
        continue;
      }
      const reason = suppressedRooms.get(region.roomIndex);
      if (reason) {
        region.failure = reason;
        region.roomIndex = -1;
        for (const seed of region.seeds) {
          failedSeeds.push({ seed: seed.asRoomSeed, reason });
        }
      } else {
        region.roomIndex = oldToNew[region.roomIndex];
      }
    }
    rooms.length = 0;
    rooms.push(...keptRooms);

    const keptPreOffsetPolygons: Float32Array[] = [];
    const keptRawPolygons: Float32Array[] = [];
    for (let oldIndex = 0; oldIndex < oldToNew.length; oldIndex += 1) {
      if (oldToNew[oldIndex] >= 0) {
        keptPreOffsetPolygons.push(roomPreOffsetPolygons[oldIndex]);
        keptRawPolygons.push(roomRawPolygons[oldIndex]);
      }
    }
    roomPreOffsetPolygons.length = 0;
    roomPreOffsetPolygons.push(...keptPreOffsetPolygons);
    roomRawPolygons.length = 0;
    roomRawPolygons.push(...keptRawPolygons);
  }

  const geometryRepair = repairRoomGeometryConflicts(
    rooms,
    roomPreOffsetPolygons,
    roomRawPolygons,
    scale
  );
  stats.geometryRepairCount = geometryRepair.repairCount;
  stats.geometryConflictSuppressionCount = geometryRepair.suppressedRoomIndices.size;
  if (geometryRepair.suppressedRoomIndices.size > 0) {
    const oldToNew = new Int32Array(rooms.length);
    oldToNew.fill(-1);
    const keptRooms: DetectedRoom[] = [];
    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
      if (geometryRepair.suppressedRoomIndices.has(roomIndex)) {
        continue;
      }
      oldToNew[roomIndex] = keptRooms.length;
      keptRooms.push(rooms[roomIndex]);
    }
    for (const region of regions) {
      if (region.roomIndex < 0) {
        continue;
      }
      if (geometryRepair.suppressedRoomIndices.has(region.roomIndex)) {
        region.failure = "overlap";
        region.roomIndex = -1;
        for (const seed of region.seeds) {
          failedSeeds.push({ seed: seed.asRoomSeed, reason: "overlap" });
        }
      } else {
        region.roomIndex = oldToNew[region.roomIndex];
      }
    }
    rooms.length = 0;
    rooms.push(...keptRooms);
  }

  // A furniture outline can touch one face of an otherwise recovered partition and
  // turn the room ring into a long, thin-mouthed detour around the table. Once an
  // independently paired structural wall has been validated, the actual boundary is
  // the nearby wall face. Include doorway-recovered wall stubs as well as the complete
  // paired hypothesis, then repair only decisive topology-safe detours; ordinary room
  // polygons never enter this path.
  stats.geometryRepairCount += repairPairedWallFurnitureNotches(
    rooms,
    pairedDoorRecovery.walls,
    pairedStructuralWalls,
    doorGapMax
  );

  // At a real orthogonal wall corner, attached equipment can replace both wall-face
  // legs with a many-segment diagonal detour. Unlike the single-wall notch repair
  // above, this uses the complete paired structural hypothesis: both perpendicular
  // legs and the kept polygon edges must be independently backed by paired wall faces.
  stats.geometryRepairCount += repairPairedWallOrthogonalCornerDetours(
    rooms,
    pairedStructuralWalls,
    doorGapMax
  );

  // A pair of long side walls and a perpendicular wall beyond them form a structural
  // three-sided cap. Large equipment symbols can join the two side contours before
  // that cap and make an entire room edge follow the equipment instead. Restore the
  // cap only when all three independently paired tracks, the retained side edges, and
  // the resulting room topology agree.
  stats.geometryRepairCount += repairPairedWallStructuralCaps(
    rooms,
    pairedStructuralWalls,
    doorGapMax
  );

  // When equipment replaces one complete side of an otherwise wall-backed rectangular
  // cell, three contour sides still agree with structural faces while the fourth sits
  // conspicuously inward. Recover only that one missing outward face from the nearest
  // long paired track; the other three sides and all topology checks remain mandatory.
  stats.geometryRepairCount += repairPairedWallRectangularEnvelope(
    rooms,
    pairedStructuralWalls,
    doorGapMax
  );

  // Some labeled zones are intentionally open on one side (patient alcoves, waiting
  // bays, work areas). Their seed can flood into a much larger room and make the final
  // contour follow furniture or remote partitions. On decisive single-color CAD pages,
  // recover only high-confidence three-sided bays from the dominant long-line cohort;
  // the missing fourth side is a straight semantic frontier, never an equipment edge.
  if (
    !options.dominantColorWallsOnly &&
    stageA.uniformWidthMode &&
    stageA.dominantLongStrokeColorFraction >= 0.5 &&
    stageA.dominantLongStrokeColorRatio >= 3
  ) {
    stats.openBayRefinementCount = refineLabelBackedOpenBays(
      rooms,
      stageA.dominantColorLongWalls,
      doorGapMax
    );
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
  /** Broader non-destructive curve candidates, used only when paired wall jambs corroborate them. */
  broadDoorArcs: Float64Array;
  eligibleSegmentCount: number;
  hairlineSegmentCount: number;
  totalStrokeLength: number;
  widthHistogram: { halfWidth: number; totalLength: number; segmentCount: number }[];
  wallHalfWidthThreshold: number;
  wallMedianHalfWidth: number;
  /** True when stroke width carried no signal and every eligible stroke was accepted. */
  uniformWidthMode: boolean;
  /** Quantized RGB cohort carrying the dominant share of long straight-stroke length. */
  dominantLongStrokeColorBins: [number, number, number] | null;
  dominantLongStrokeColorFraction: number;
  dominantLongStrokeColorRatio: number;
  /** Long straight strokes belonging to the dominant RGB cohort. */
  dominantColorLongWalls: Float64Array;
  /** All eligible straight strokes [x0,y0,x1,y1], used by paired-wall hypotheses and recovery. */
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

  // First pass: stroke-width statistics over eligible visible segments. Device
  // hairlines have no scene-space width, so an opted-in hypothesis assigns them a
  // conservative page-relative nominal width (roughly the common thin-pen class).
  const histogramByWidth = new Map<number, { halfWidth: number; totalLength: number; segmentCount: number }>();
  const longLengthByColor = new Map<string, { bins: [number, number, number]; length: number }>();
  const eligible: number[] = [];
  const nominalHairlineHalfWidth = Math.max(1e-6, 0.00003 * pageDiagonal);
  let hairlineSegmentCount = 0;
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
    const rawHalfWidth = styles[base];
    const { alpha, styleFlags } = decodeStrokeStyleMeta(primitiveMeta[base + 3]);
    if (alpha < 0.5) {
      continue;
    }
    const isHairline = !(rawHalfWidth > 0) || (styleFlags & STROKE_STYLE_FLAG_HAIRLINE) !== 0;
    if (isHairline) {
      hairlineSegmentCount += 1;
      if (!options.includeHairlineStrokes) {
        continue;
      }
    }
    const halfWidth = isHairline ? Math.max(rawHalfWidth, nominalHairlineHalfWidth) : rawHalfWidth;
    const x0 = endpoints[base];
    const y0 = endpoints[base + 1];
    const primitiveType = primitiveMeta[base + 2];
    const isQuadratic = primitiveType >= 0.5;
    // Stroke primitives pack [start, control] in `endpoints` and the true end point
    // in `primitiveMeta`. Straight strokes duplicate their end as the control point.
    // Using the control as a quadratic's end disconnects consecutive curve pieces and
    // makes a valid door swing look like several unrelated symbols.
    const controlOrEndX = endpoints[base + 2];
    const controlOrEndY = endpoints[base + 3];
    const x1 = isQuadratic ? primitiveMeta[base] : controlOrEndX;
    const y1 = isQuadratic ? primitiveMeta[base + 1] : controlOrEndY;
    const length = isQuadratic
      ? Math.hypot(controlOrEndX - x0, controlOrEndY - y0) + Math.hypot(x1 - controlOrEndX, y1 - controlOrEndY)
      : Math.hypot(x1 - x0, y1 - y0);
    if (!(length > 0)) {
      continue;
    }

    eligible.push(i);
    totalStrokeLength += length;
    if (!isQuadratic && length >= 0.01 * pageDiagonal) {
      const bins: [number, number, number] = [
        Math.max(0, Math.min(64, Math.round(styles[base + 1] * 64))),
        Math.max(0, Math.min(64, Math.round(styles[base + 2] * 64))),
        Math.max(0, Math.min(64, Math.round(styles[base + 3] * 64)))
      ];
      const colorKey = bins.join(",");
      const colorBucket = longLengthByColor.get(colorKey);
      if (colorBucket) {
        colorBucket.length += length;
      } else {
        longLengthByColor.set(colorKey, { bins, length });
      }
    }
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
  const longColorBuckets = [...longLengthByColor.values()].sort((a, b) => b.length - a.length);
  const dominantLongStrokeColorBins = longColorBuckets[0]?.bins ?? null;
  const totalLongStrokeLength = longColorBuckets.reduce((sum, bucket) => sum + bucket.length, 0);
  const dominantLongStrokeColorFraction =
    totalLongStrokeLength > 0 ? (longColorBuckets[0]?.length ?? 0) / totalLongStrokeLength : 0;
  const dominantLongStrokeColorRatio =
    longColorBuckets.length < 2
      ? dominantLongStrokeColorBins
        ? Number.POSITIVE_INFINITY
        : 0
      : longColorBuckets[0].length / Math.max(1e-9, longColorBuckets[1].length);

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
  const wallCurveRadiusMin = 0.012 * pageDiagonal;
  // Door swings are commonly 1.5-2.5% of the sheet diagonal in cropped CAD exports.
  // Search farther for evidence than for destructive wall removal: a rejected symbol
  // candidate must not make a genuinely curved building wall disappear.
  const doorArcRadiusMax = 0.03 * pageDiagonal;
  const doubleLineMode = options.wallDetectionMode === "doubleLine";
  const walls: number[] = [];
  const doorArcs: number[] = [];
  const broadDoorArcs: number[] = [];
  const straightPiecesByWidth = new Map<number, number[]>();
  const rawStraightSegments: number[] = [];
  const dominantColorLongWalls: number[] = [];
  const acceptedWidthLengths: { halfWidth: number; length: number }[] = [];
  for (const i of eligible) {
    const base = i * 4;
    const rawHalfWidth = styles[base];
    const { styleFlags } = decodeStrokeStyleMeta(primitiveMeta[base + 3]);
    const halfWidth =
      !(rawHalfWidth > 0) || (styleFlags & STROKE_STYLE_FLAG_HAIRLINE) !== 0
        ? Math.max(rawHalfWidth, nominalHairlineHalfWidth)
        : rawHalfWidth;
    const primitiveType = primitiveMeta[base + 2];
    const isQuadratic = primitiveType >= 0.5;
    const x0 = endpoints[base];
    const y0 = endpoints[base + 1];
    const controlOrEndX = endpoints[base + 2];
    const controlOrEndY = endpoints[base + 3];
    const endX = isQuadratic ? primitiveMeta[base] : controlOrEndX;
    const endY = isQuadratic ? primitiveMeta[base + 1] : controlOrEndY;
    const belongsToDominantColor =
      dominantLongStrokeColorBins !== null &&
      Math.round(styles[base + 1] * 64) === dominantLongStrokeColorBins[0] &&
      Math.round(styles[base + 2] * 64) === dominantLongStrokeColorBins[1] &&
      Math.round(styles[base + 3] * 64) === dominantLongStrokeColorBins[2];

    if (!isQuadratic && belongsToDominantColor && Math.hypot(endX - x0, endY - y0) >= longWallMinLength) {
      dominantColorLongWalls.push(x0, y0, endX, endY, halfWidth);
    }

    if (options.dominantColorWallsOnly && !belongsToDominantColor) {
      continue;
    }

    // Door swings in many CAD PDFs have already been flattened to straight pieces by
    // the producer. Keep those pieces grouped by pen width before wall classification:
    // the arc usually uses a thin symbol pen, and mixing it with thicker jamb/leaf
    // segments creates endpoint junctions that hide the otherwise clean curved chain.
    if (!isQuadratic) {
      rawStraightSegments.push(x0, y0, endX, endY);
      const widthKey = Math.round(halfWidth * 4096) / 4096;
      const pieces = straightPiecesByWidth.get(widthKey);
      if (pieces) {
        pieces.push(x0, y0, endX, endY, halfWidth);
      } else {
        straightPiecesByWidth.set(widthKey, [x0, y0, endX, endY, halfWidth]);
      }
    }

    if (isQuadratic) {
      const cx = controlOrEndX;
      const cy = controlOrEndY;
      const chord = Math.hypot(endX - x0, endY - y0);
      const sagitta = Math.hypot(x0 - 2 * cx + endX, y0 - 2 * cy + endY) / 4;
      const decisivelyCurved = sagitta > 0.05 * Math.max(chord, 1e-9);
      // A slightly broader threshold is safe for evidence collection because these
      // candidates are never removed or used alone: paired wall jambs must corroborate
      // them. Keep the stricter threshold for destructive wall classification.
      if (sagitta > 0.04 * Math.max(chord, 1e-9)) {
        const radius = (chord * chord) / (8 * sagitta) + sagitta / 2;
        if (radius < doorArcRadiusMax) {
          // Preserve a broad, non-destructive swing-candidate set. Curves just above
          // the wall-removal threshold can still be door swings at the page's inferred
          // scale; they remain wall candidates too unless their radius is decisively
          // tight. Later component and wall-jamb context decides whether they are door
          // evidence, so a gently curved building wall is not removed here.
          let prevX = x0;
          let prevY = y0;
          const broadStart = broadDoorArcs.length;
          for (let k = 1; k <= 4; k += 1) {
            const t = k / 4;
            const mt = 1 - t;
            const px = mt * mt * x0 + 2 * mt * t * cx + t * t * endX;
            const py = mt * mt * y0 + 2 * mt * t * cy + t * t * endY;
            broadDoorArcs.push(prevX, prevY, px, py, halfWidth);
            prevX = px;
            prevY = py;
          }
          if (decisivelyCurved && radius < wallCurveRadiusMin) {
            for (let arcBase = broadStart; arcBase < broadDoorArcs.length; arcBase += WALL_STRIDE) {
              doorArcs.push(
                broadDoorArcs[arcBase],
                broadDoorArcs[arcBase + 1],
                broadDoorArcs[arcBase + 2],
                broadDoorArcs[arcBase + 3],
                broadDoorArcs[arcBase + 4]
              );
            }
          }
        }
        if (decisivelyCurved && radius < wallCurveRadiusMin) {
          continue;
        }
      }
    }

    if (doubleLineMode) {
      // Double-line mode classifies by parallel-pair structure instead of width; collect
      // every straight piece (gentle curves rarely form wall faces and are skipped).
      continue;
    }

    if (halfWidth < wallHalfWidthThreshold) {
      const isLongStraight =
        !isQuadratic && halfWidth >= longWallHalfWidthMin && Math.hypot(endX - x0, endY - y0) >= longWallMinLength;
      if (!isLongStraight) {
        continue;
      }
      walls.push(x0, y0, endX, endY, halfWidth);
      continue;
    }

    if (isQuadratic) {
      // Quadratic: endpoints[2..3] is the control point; primitiveMeta[0..1] is
      // the true end point. Flatten the correctly connected curve into subsegments.
      const cx = controlOrEndX;
      const cy = controlOrEndY;
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
      broadDoorArcs: new Float64Array(broadDoorArcs),
      eligibleSegmentCount: eligible.length,
      hairlineSegmentCount,
      totalStrokeLength,
      widthHistogram,
      wallHalfWidthThreshold,
      wallMedianHalfWidth: lengthWeightedMedianHalfWidth(acceptedWidthLengths),
      uniformWidthMode,
      dominantLongStrokeColorBins,
      dominantLongStrokeColorFraction,
      dominantLongStrokeColorRatio,
      dominantColorLongWalls: new Float64Array(dominantColorLongWalls),
      rawSegments: new Float64Array(rawStraightSegments)
    };
  }

  const flattenedArcPieces: number[] = [];
  for (const pieces of straightPiecesByWidth.values()) {
    dropPolylineArcChains(pieces, doorArcRadiusMax, flattenedArcPieces);
  }
  for (let i = 0; i + 4 < flattenedArcPieces.length; i += WALL_STRIDE) {
    doorArcs.push(
      flattenedArcPieces[i],
      flattenedArcPieces[i + 1],
      flattenedArcPieces[i + 2],
      flattenedArcPieces[i + 3],
      flattenedArcPieces[i + 4]
    );
    broadDoorArcs.push(
      flattenedArcPieces[i],
      flattenedArcPieces[i + 1],
      flattenedArcPieces[i + 2],
      flattenedArcPieces[i + 3],
      flattenedArcPieces[i + 4]
    );
  }
  const wallsFiltered = dropPolylineArcChains(walls, wallCurveRadiusMin, doorArcs);

  return {
    walls: new Float64Array(wallsFiltered),
    doorArcs: new Float64Array(doorArcs),
    broadDoorArcs: new Float64Array(broadDoorArcs),
    eligibleSegmentCount: eligible.length,
    hairlineSegmentCount,
    totalStrokeLength,
    widthHistogram,
    wallHalfWidthThreshold,
    wallMedianHalfWidth: lengthWeightedMedianHalfWidth(acceptedWidthLengths),
    uniformWidthMode,
    dominantLongStrokeColorBins,
    dominantLongStrokeColorFraction,
    dominantLongStrokeColorRatio,
    dominantColorLongWalls: new Float64Array(dominantColorLongWalls),
    rawSegments: new Float64Array(rawStraightSegments)
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
  segments: ArrayLike<number>,
  pageMinX: number,
  pageMinY: number,
  pageMaxX: number,
  pageMaxY: number,
  pageDiagonal: number,
  strokeHalfWidth: number,
  longSingleMinLength: number,
  includeUnpaired = true,
  minChainLengthFactor = 0.006,
  allowCavityEndpointInk = false
): number[] {
  const BIN_COUNT = 120; // 1.5 degrees of line angle per bin (axial doubling below)
  const offsetTol = Math.max(0.0004 * pageDiagonal, 2 * strokeHalfWidth);
  const chainGapTol = 0.0025 * pageDiagonal;
  const minChainLength = minChainLengthFactor * pageDiagonal;
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
        let consideredSamples = 0;
        for (let s = 0; s <= sampleCount; s += 1) {
          // Short wall stubs commonly terminate in jamb/corner caps at both ends. The
          // recovery-only hypothesis may ignore exactly those endpoint samples, while
          // still requiring the cavity interior to remain clear. Normal double-line
          // wall classification retains the stricter all-samples behavior.
          if (allowCavityEndpointInk && (s === 0 || s === sampleCount)) {
            continue;
          }
          consideredSamples += 1;
          const t = overlap0 + (overlap / sampleCount) * s;
          if (inkAt(dirX * t + normX * cMid, dirY * t + normY * cMid) !== 0) {
            inkedSamples += 1;
          }
        }
        if (inkedSamples / Math.max(1, consideredSamples) > 0.15) {
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
    if (!includeUnpaired || !binHasPairs) {
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

interface PairedTrackDoorRecovery {
  /** Paired structural runs on both sides of each recovered opening. */
  walls: number[];
  /** Center-line bridges across the validated door openings. */
  closures: number[];
}

/**
 * Restore a narrowly-scoped piece of paired-wall topology that density pruning can
 * erase on uniformly thin CAD drawings: a complete paired partition stub, when a
 * structural cap, a door swing, and nearby room-number anchors on opposite sides all
 * agree.
 *
 * The semantic anchors are deliberately only supporting evidence. Geometry still has
 * to establish a paired structural track and its endpoint context, which prevents a
 * pair of desk/table edges between two incidental numbers from becoming a wall.
 */
function buildLabelBackedPairedPartitionRecovery(
  pairedWalls: number[],
  doorArcs: Float64Array,
  seeds: PageSeed[],
  occupancy: Uint8Array,
  rasterWidth: number,
  rasterHeight: number,
  worldToRasterX: (x: number) => number,
  worldToRasterY: (y: number) => number,
  scale: number,
  doorGapMax: number
): PairedTrackDoorRecovery {
  const pairedWallCount = pairedWalls.length / WALL_STRIDE;
  if (pairedWallCount === 0 || !(doorGapMax > 0) || !(scale > 0)) {
    return { walls: [], closures: [] };
  }

  const numericLabelPattern = /^(?:\d{3,6}[a-z]?|[a-z]{1,2}\d{2,6}[a-z]?)$/i;
  const numericSeeds = seeds.filter((seed) => numericLabelPattern.test(seed.label.trim()));
  const measuredLabelHeights = numericSeeds
    .map((seed) => (seed.item ? Math.max(0, seed.item.maxY - seed.item.minY) : 0))
    .filter((height) => height > 0)
    .sort((left, right) => left - right);
  const upperLabelHeight =
    measuredLabelHeights[Math.min(measuredLabelHeights.length - 1, Math.floor(0.85 * measuredLabelHeights.length))] ?? 0;
  const strongLabelHeight = Math.max(0.1 * doorGapMax, 0.82 * upperLabelHeight);
  const anchors = numericSeeds.filter(
    (seed) => !seed.item || seed.item.maxY - seed.item.minY >= strongLabelHeight
  );
  if (anchors.length < 2) {
    return { walls: [], closures: [] };
  }

  const alignmentMin = Math.cos((5 * Math.PI) / 180);
  const perpendicularAlignmentMax = Math.sin((10 * Math.PI) / 180);
  const anchorReach = 1.5 * doorGapMax;
  const samplePixel = (worldX: number, worldY: number): boolean => {
    const x = Math.round(worldToRasterX(worldX));
    const y = Math.round(worldToRasterY(worldY));
    if (x < 0 || y < 0 || x >= rasterWidth || y >= rasterHeight) {
      return false;
    }
    return occupancy[y * rasterWidth + x] !== 0;
  };
  const occupancyCoverage = (wallIndex: number): number => {
    const base = wallIndex * WALL_STRIDE;
    const x0 = pairedWalls[base];
    const y0 = pairedWalls[base + 1];
    const x1 = pairedWalls[base + 2];
    const y1 = pairedWalls[base + 3];
    const halfWidth = pairedWalls[base + 4];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) {
      return 0;
    }
    const dirX = dx / length;
    const dirY = dy / length;
    const normX = -dirY;
    const normY = dirX;
    const stationCount = Math.max(5, Math.ceil(length / (0.15 * doorGapMax)));
    let occupiedStations = 0;
    for (let station = 0; station <= stationCount; station += 1) {
      const along = station / stationCount;
      const x = x0 + dx * along;
      const y = y0 + dy * along;
      const faceOffset = Math.max(halfWidth * 0.7, 0.5 / scale);
      if (
        samplePixel(x, y) ||
        samplePixel(x + normX * faceOffset, y + normY * faceOffset) ||
        samplePixel(x - normX * faceOffset, y - normY * faceOffset)
      ) {
        occupiedStations += 1;
      }
    }
    return occupiedStations / (stationCount + 1);
  };
  const wallFrame = (wallIndex: number): {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    halfWidth: number;
    length: number;
    dirX: number;
    dirY: number;
    normX: number;
    normY: number;
    minT: number;
    maxT: number;
    c: number;
  } | null => {
    const base = wallIndex * WALL_STRIDE;
    const x0 = pairedWalls[base];
    const y0 = pairedWalls[base + 1];
    const x1 = pairedWalls[base + 2];
    const y1 = pairedWalls[base + 3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) {
      return null;
    }
    const dirX = dx / length;
    const dirY = dy / length;
    const normX = -dirY;
    const normY = dirX;
    const firstT = x0 * dirX + y0 * dirY;
    const secondT = x1 * dirX + y1 * dirY;
    return {
      x0,
      y0,
      x1,
      y1,
      halfWidth: pairedWalls[base + 4],
      length,
      dirX,
      dirY,
      normX,
      normY,
      minT: Math.min(firstT, secondT),
      maxT: Math.max(firstT, secondT),
      c: 0.5 * ((x0 + x1) * normX + (y0 + y1) * normY)
    };
  };
  const hasOpposingAnchors = (frame: NonNullable<ReturnType<typeof wallFrame>>): boolean => {
    let hasNegative = false;
    let hasPositive = false;
    for (const anchor of anchors) {
      const t = anchor.x * frame.dirX + anchor.y * frame.dirY;
      if (t < frame.minT - 0.35 * doorGapMax || t > frame.maxT + 0.35 * doorGapMax) {
        continue;
      }
      const signedDistance = anchor.x * frame.normX + anchor.y * frame.normY - frame.c;
      const distance = Math.abs(signedDistance);
      if (distance < 0.2 * doorGapMax || distance > anchorReach) {
        continue;
      }
      hasNegative ||= signedDistance < 0;
      hasPositive ||= signedDistance > 0;
    }
    return hasNegative && hasPositive;
  };
  const hasPairedPerpendicularSupport = (
    sourceIndex: number,
    frame: NonNullable<ReturnType<typeof wallFrame>>,
    x: number,
    y: number,
    minLength: number
  ): boolean => {
    const supportRadius = Math.max(0.25 * doorGapMax, 2 * frame.halfWidth);
    for (let wallIndex = 0; wallIndex < pairedWallCount; wallIndex += 1) {
      if (wallIndex === sourceIndex) {
        continue;
      }
      const base = wallIndex * WALL_STRIDE;
      const dx = pairedWalls[base + 2] - pairedWalls[base];
      const dy = pairedWalls[base + 3] - pairedWalls[base + 1];
      const length = Math.hypot(dx, dy);
      if (
        length < minLength ||
        Math.abs((dx * frame.dirX + dy * frame.dirY) / Math.max(length, 1e-9)) > perpendicularAlignmentMax
      ) {
        continue;
      }
      const reach = supportRadius + pairedWalls[base + 4];
      if (
        distanceToSegmentSquared(
          x,
          y,
          pairedWalls[base],
          pairedWalls[base + 1],
          pairedWalls[base + 2],
          pairedWalls[base + 3]
        ) <= reach * reach
      ) {
        return true;
      }
    }
    return false;
  };
  const hasDoorArcAttachment = (x: number, y: number, halfWidth: number): boolean => {
    const radius = Math.max(0.28 * doorGapMax, 2 * halfWidth);
    for (let base = 0; base + 4 < doorArcs.length; base += WALL_STRIDE) {
      if (
        distanceToSegmentSquared(x, y, doorArcs[base], doorArcs[base + 1], doorArcs[base + 2], doorArcs[base + 3]) <=
        radius * radius
      ) {
        return true;
      }
    }
    return false;
  };

  const walls: number[] = [];
  const recoveredFrames: NonNullable<ReturnType<typeof wallFrame>>[] = [];
  const orderedWallIndexes = Array.from({ length: pairedWallCount }, (_, index) => index).sort((left, right) => {
    const leftFrame = wallFrame(left);
    const rightFrame = wallFrame(right);
    return (rightFrame?.length ?? 0) - (leftFrame?.length ?? 0);
  });

  for (const wallIndex of orderedWallIndexes) {
    const frame = wallFrame(wallIndex);
    if (!frame || frame.length < 1.5 * doorGapMax || occupancyCoverage(wallIndex) > 0.3 || !hasOpposingAnchors(frame)) {
      continue;
    }
    const firstSupported = hasPairedPerpendicularSupport(wallIndex, frame, frame.x0, frame.y0, 2 * doorGapMax);
    const secondSupported = hasPairedPerpendicularSupport(wallIndex, frame, frame.x1, frame.y1, 2 * doorGapMax);
    const firstHasDoor = hasDoorArcAttachment(frame.x0, frame.y0, frame.halfWidth);
    const secondHasDoor = hasDoorArcAttachment(frame.x1, frame.y1, frame.halfWidth);
    if (!((firstSupported && secondHasDoor) || (secondSupported && firstHasDoor))) {
      continue;
    }
    const duplicate = recoveredFrames.some((other) => {
      const alignment = Math.abs(frame.dirX * other.dirX + frame.dirY * other.dirY);
      if (alignment < alignmentMin || Math.abs(frame.c - other.c) > 0.08 * doorGapMax) {
        return false;
      }
      const overlap = Math.min(frame.maxT, other.maxT) - Math.max(frame.minT, other.minT);
      return overlap >= 0.7 * Math.min(frame.length, other.length);
    });
    if (!duplicate) {
      recoveredFrames.push(frame);
      walls.push(frame.x0, frame.y0, frame.x1, frame.y1, frame.halfWidth);
    }
  }

  return { walls, closures: [] };
}

/**
 * Recover door openings that are slightly wider than the ordinary whisker limit when
 * both sides are independently recognized as paired wall faces. This runs only on the
 * structural output of `buildDoubleLineWalls`, never on arbitrary long strokes. A
 * context-checked swing arc must attach to a jamb, which keeps paired table/desk edges
 * from manufacturing partitions on uniformly thin CAD plans.
 */
function buildPairedTrackDoorRecovery(
  pairedWalls: number[],
  doorArcs: Float64Array,
  doorGapMax: number,
  closureGapMax: number
): PairedTrackDoorRecovery {
  const wallCount = pairedWalls.length / WALL_STRIDE;
  if (wallCount < 2 || doorArcs.length === 0 || !(doorGapMax > 0)) {
    return { walls: [], closures: [] };
  }

  const alignmentMin = Math.cos((5 * Math.PI) / 180);
  const minGap = 1.05 * doorGapMax;
  const maxGap = 1.05 * closureGapMax;
  const arcAttachmentRadius = 0.38 * doorGapMax;
  const arcAttachmentRadiusSquared = arcAttachmentRadius * arcAttachmentRadius;
  const recovered = new Map<
    string,
    {
      score: number;
      earlier: number;
      later: number;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      halfWidth: number;
      dirX: number;
      dirY: number;
      c: number;
    }
  >();

  for (let first = 0; first < wallCount; first += 1) {
    const firstBase = first * WALL_STRIDE;
    const firstDx = pairedWalls[firstBase + 2] - pairedWalls[firstBase];
    const firstDy = pairedWalls[firstBase + 3] - pairedWalls[firstBase + 1];
    const firstLength = Math.hypot(firstDx, firstDy);
    if (!(firstLength > 0)) {
      continue;
    }
    const dirX = firstDx / firstLength;
    const dirY = firstDy / firstLength;
    const normX = -dirY;
    const normY = dirX;
    const firstT0 = pairedWalls[firstBase] * dirX + pairedWalls[firstBase + 1] * dirY;
    const firstT1 = pairedWalls[firstBase + 2] * dirX + pairedWalls[firstBase + 3] * dirY;
    const firstMinT = Math.min(firstT0, firstT1);
    const firstMaxT = Math.max(firstT0, firstT1);
    const firstC =
      0.5 *
      ((pairedWalls[firstBase] + pairedWalls[firstBase + 2]) * normX +
        (pairedWalls[firstBase + 1] + pairedWalls[firstBase + 3]) * normY);

    for (let second = first + 1; second < wallCount; second += 1) {
      const secondBase = second * WALL_STRIDE;
      const secondDx = pairedWalls[secondBase + 2] - pairedWalls[secondBase];
      const secondDy = pairedWalls[secondBase + 3] - pairedWalls[secondBase + 1];
      const secondLength = Math.hypot(secondDx, secondDy);
      if (!(secondLength > 0)) {
        continue;
      }
      const alignment = (secondDx * dirX + secondDy * dirY) / secondLength;
      if (Math.abs(alignment) < alignmentMin) {
        continue;
      }

      const secondT0 = pairedWalls[secondBase] * dirX + pairedWalls[secondBase + 1] * dirY;
      const secondT1 = pairedWalls[secondBase + 2] * dirX + pairedWalls[secondBase + 3] * dirY;
      const secondMinT = Math.min(secondT0, secondT1);
      const secondMaxT = Math.max(secondT0, secondT1);
      let earlier = first;
      let later = second;
      let gapStartT = firstMaxT;
      let gapEndT = secondMinT;
      if (secondMaxT < firstMinT) {
        earlier = second;
        later = first;
        gapStartT = secondMaxT;
        gapEndT = firstMinT;
      } else if (firstMaxT >= secondMinT) {
        continue; // overlapping runs are one wall section, not an opening
      }
      const gap = gapEndT - gapStartT;
      if (gap < minGap || gap > maxGap) {
        continue;
      }
      if (
        Math.min(firstLength, secondLength) < 0.3 * gap ||
        Math.max(firstLength, secondLength) < 4 * doorGapMax ||
        firstLength + secondLength < 6 * doorGapMax
      ) {
        continue;
      }

      const secondC =
        0.5 *
        ((pairedWalls[secondBase] + pairedWalls[secondBase + 2]) * normX +
          (pairedWalls[secondBase + 1] + pairedWalls[secondBase + 3]) * normY);
      const firstHalfWidth = pairedWalls[firstBase + 4];
      const secondHalfWidth = pairedWalls[secondBase + 4];
      const minHalfWidth = Math.min(firstHalfWidth, secondHalfWidth);
      const maxHalfWidth = Math.max(firstHalfWidth, secondHalfWidth);
      if (
        Math.abs(secondC - firstC) > Math.max(0.04 * doorGapMax, 0.75 * (firstHalfWidth + secondHalfWidth)) ||
        !(minHalfWidth > 0) ||
        maxHalfWidth > 2.25 * minHalfWidth
      ) {
        continue;
      }

      const earlierBase = earlier * WALL_STRIDE;
      const laterBase = later * WALL_STRIDE;
      const earlierT0 = pairedWalls[earlierBase] * dirX + pairedWalls[earlierBase + 1] * dirY;
      const earlierT1 = pairedWalls[earlierBase + 2] * dirX + pairedWalls[earlierBase + 3] * dirY;
      const laterT0 = pairedWalls[laterBase] * dirX + pairedWalls[laterBase + 1] * dirY;
      const laterT1 = pairedWalls[laterBase + 2] * dirX + pairedWalls[laterBase + 3] * dirY;
      const earlierEndOffset = earlierT0 > earlierT1 ? 0 : 2;
      const laterEndOffset = laterT0 < laterT1 ? 0 : 2;
      const x0 = pairedWalls[earlierBase + earlierEndOffset];
      const y0 = pairedWalls[earlierBase + earlierEndOffset + 1];
      const x1 = pairedWalls[laterBase + laterEndOffset];
      const y1 = pairedWalls[laterBase + laterEndOffset + 1];

      let attachedArc = false;
      for (let arcBase = 0; arcBase + 4 < doorArcs.length; arcBase += WALL_STRIDE) {
        for (let end = 0; end < 2; end += 1) {
          const arcX = doorArcs[arcBase + end * 2];
          const arcY = doorArcs[arcBase + end * 2 + 1];
          if (
            Math.min(
              (arcX - x0) ** 2 + (arcY - y0) ** 2,
              (arcX - x1) ** 2 + (arcY - y1) ** 2
            ) <= arcAttachmentRadiusSquared
          ) {
            attachedArc = true;
            break;
          }
        }
        if (attachedArc) {
          break;
        }
      }
      if (!attachedArc) {
        continue;
      }

      const midpointX = 0.5 * (x0 + x1);
      const midpointY = 0.5 * (y0 + y1);
      const angle = Math.atan2(dirY, dirX);
      // Wall axes are undirected: the same track may arrive with either endpoint
      // ordering. Canonicalize modulo PI so opposite runs deduplicate together.
      const axialAngle = ((angle % Math.PI) + Math.PI) % Math.PI;
      const key = `${Math.round(midpointX / (0.12 * doorGapMax))},${Math.round(midpointY / (0.12 * doorGapMax))},${Math.round(axialAngle / ((5 * Math.PI) / 180))}`;
      const score = firstLength + secondLength;
      const current = recovered.get(key);
      if (!current || score > current.score) {
        recovered.set(key, {
          score,
          earlier,
          later,
          x0,
          y0,
          x1,
          y1,
          halfWidth: maxHalfWidth,
          dirX,
          dirY,
          c: 0.5 * (firstC + secondC)
        });
      }
    }
  }

  const walls: number[] = [];
  const closures: number[] = [];
  const wallKeys = new Set<string>();
  const bridgeKeys = new Set<string>();
  for (const recovery of recovered.values()) {
    const selected = new Set<number>([recovery.earlier, recovery.later]);
    const normX = -recovery.dirY;
    const normY = recovery.dirX;
    let minT = Number.POSITIVE_INFINITY;
    let maxT = Number.NEGATIVE_INFINITY;
    const includeSpan = (wallIndex: number): void => {
      const base = wallIndex * WALL_STRIDE;
      const t0 = pairedWalls[base] * recovery.dirX + pairedWalls[base + 1] * recovery.dirY;
      const t1 = pairedWalls[base + 2] * recovery.dirX + pairedWalls[base + 3] * recovery.dirY;
      minT = Math.min(minT, t0, t1);
      maxT = Math.max(maxT, t0, t1);
    };
    includeSpan(recovery.earlier);
    includeSpan(recovery.later);

    // Once a real oversized doorway anchors a paired wall track, grow through adjacent
    // paired glazing/window runs on that same axis. Density pruning often removed those
    // sparse runs independently; restoring only the two jamb runs would leave another
    // leak a few feet farther along the same physical wall.
    let changed = true;
    while (changed) {
      changed = false;
      for (let wallIndex = 0; wallIndex < wallCount; wallIndex += 1) {
        if (selected.has(wallIndex)) {
          continue;
        }
        const base = wallIndex * WALL_STRIDE;
        const dx = pairedWalls[base + 2] - pairedWalls[base];
        const dy = pairedWalls[base + 3] - pairedWalls[base + 1];
        const length = Math.hypot(dx, dy);
        if (!(length >= 0.25 * doorGapMax)) {
          continue;
        }
        const alignment = Math.abs((dx * recovery.dirX + dy * recovery.dirY) / length);
        if (alignment < alignmentMin) {
          continue;
        }
        const candidateC =
          0.5 *
          ((pairedWalls[base] + pairedWalls[base + 2]) * normX +
            (pairedWalls[base + 1] + pairedWalls[base + 3]) * normY);
        const halfWidth = pairedWalls[base + 4];
        if (
          Math.abs(candidateC - recovery.c) > Math.max(0.04 * doorGapMax, 0.75 * (halfWidth + recovery.halfWidth)) ||
          halfWidth > 2.25 * recovery.halfWidth ||
          recovery.halfWidth > 2.25 * halfWidth
        ) {
          continue;
        }
        const t0 = pairedWalls[base] * recovery.dirX + pairedWalls[base + 1] * recovery.dirY;
        const t1 = pairedWalls[base + 2] * recovery.dirX + pairedWalls[base + 3] * recovery.dirY;
        const candidateMinT = Math.min(t0, t1);
        const candidateMaxT = Math.max(t0, t1);
        const distance = candidateMinT > maxT ? candidateMinT - maxT : minT > candidateMaxT ? minT - candidateMaxT : 0;
        if (distance > closureGapMax) {
          continue;
        }
        selected.add(wallIndex);
        minT = Math.min(minT, candidateMinT);
        maxT = Math.max(maxT, candidateMaxT);
        changed = true;
      }
    }

    // A partition track terminates into independently paired structural material at
    // both remote ends. Single-line table caps can be long and perpendicular too, so
    // arbitrary retained strokes are insufficient evidence. Paired face chains can
    // end slightly short of the intersecting pair when their two PDF faces terminate
    // unevenly; a quarter-door tolerance absorbs that mismatch without reaching a
    // floating furniture symbol.
    const endpointSupportRadius = Math.max(0.25 * doorGapMax, 2 * recovery.halfWidth);
    const perpendicularAlignmentMax = Math.sin((10 * Math.PI) / 180);
    const hasPerpendicularSupport = (t: number): boolean => {
      const x = recovery.dirX * t + normX * recovery.c;
      const y = recovery.dirY * t + normY * recovery.c;
      for (let wallIndex = 0; wallIndex < wallCount; wallIndex += 1) {
        if (selected.has(wallIndex)) {
          continue;
        }
        const base = wallIndex * WALL_STRIDE;
        const dx = pairedWalls[base + 2] - pairedWalls[base];
        const dy = pairedWalls[base + 3] - pairedWalls[base + 1];
        const length = Math.hypot(dx, dy);
        if (!(length >= 2 * doorGapMax)) {
          continue;
        }
        if (Math.abs((dx * recovery.dirX + dy * recovery.dirY) / length) > perpendicularAlignmentMax) {
          continue;
        }
        const reach = endpointSupportRadius + pairedWalls[base + 4];
        if (
          distanceToSegmentSquared(
            x,
            y,
            pairedWalls[base],
            pairedWalls[base + 1],
            pairedWalls[base + 2],
            pairedWalls[base + 3]
          ) <= reach * reach
        ) {
          return true;
        }
      }
      return false;
    };
    if (!hasPerpendicularSupport(minT) || !hasPerpendicularSupport(maxT)) {
      continue;
    }

    closures.push(recovery.x0, recovery.y0, recovery.x1, recovery.y1, recovery.halfWidth);

    const intervals: { wallIndex: number; minT: number; maxT: number }[] = [];
    for (const wallIndex of selected) {
      const base = wallIndex * WALL_STRIDE;
      const key = `${wallIndex}`;
      if (!wallKeys.has(key)) {
        wallKeys.add(key);
        walls.push(
          pairedWalls[base],
          pairedWalls[base + 1],
          pairedWalls[base + 2],
          pairedWalls[base + 3],
          pairedWalls[base + 4]
        );
      }
      const t0 = pairedWalls[base] * recovery.dirX + pairedWalls[base + 1] * recovery.dirY;
      const t1 = pairedWalls[base + 2] * recovery.dirX + pairedWalls[base + 3] * recovery.dirY;
      intervals.push({ wallIndex, minT: Math.min(t0, t1), maxT: Math.max(t0, t1) });
    }
    intervals.sort((left, right) => left.minT - right.minT || left.maxT - right.maxT);
    let coveredTo = intervals[0]?.maxT ?? 0;
    for (let index = 1; index < intervals.length; index += 1) {
      const interval = intervals[index];
      if (interval.minT > coveredTo + 1e-6 && interval.minT - coveredTo <= closureGapMax) {
        let bridgeX0 = recovery.dirX * coveredTo + normX * recovery.c;
        let bridgeY0 = recovery.dirY * coveredTo + normY * recovery.c;
        let bridgeX1 = recovery.dirX * interval.minT + normX * recovery.c;
        let bridgeY1 = recovery.dirY * interval.minT + normY * recovery.c;
        if (bridgeX0 > bridgeX1 || (bridgeX0 === bridgeX1 && bridgeY0 > bridgeY1)) {
          [bridgeX0, bridgeX1] = [bridgeX1, bridgeX0];
          [bridgeY0, bridgeY1] = [bridgeY1, bridgeY0];
        }
        const bridgeQuantization = 0.04 * doorGapMax;
        // Key by canonical world endpoints rather than axis-local coordinates. This
        // prevents perpendicular tracks with coincident projections from colliding.
        const bridgeKey = `${Math.round(bridgeX0 / bridgeQuantization)},${Math.round(bridgeY0 / bridgeQuantization)},${Math.round(bridgeX1 / bridgeQuantization)},${Math.round(bridgeY1 / bridgeQuantization)}`;
        if (!bridgeKeys.has(bridgeKey)) {
          bridgeKeys.add(bridgeKey);
          walls.push(
            bridgeX0,
            bridgeY0,
            bridgeX1,
            bridgeY1,
            recovery.halfWidth
          );
        }
      }
      coveredTo = Math.max(coveredTo, interval.maxT);
    }
  }
  return { walls, closures };
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

/**
 * Keep only door-like curved-stroke components: one open, non-branching arc of a
 * plausible door-swing size with at least one endpoint attached to structural wall
 * material. PDF vector streams also contain tight curves for toilets, tables, chairs,
 * bubbles, and symbols; treating every such curve as access evidence made arbitrary
 * sealed pockets pass the door gate.
 */
function filterDoorArcComponents(
  arcs: Float64Array,
  walls: Float64Array,
  grid: WallGrid,
  wallWidth: number,
  doorGapMax: number
): Float64Array {
  const arcCount = arcs.length / WALL_STRIDE;
  if (arcCount === 0 || walls.length === 0) {
    return new Float64Array(0);
  }

  const endpointTolerance = Math.max(1e-6, 0.2 * wallWidth);
  const endpointKey = (x: number, y: number): string =>
    `${Math.round(x / endpointTolerance)},${Math.round(y / endpointTolerance)}`;
  const keys: [string, string][] = new Array(arcCount);
  const arcsByEndpoint = new Map<string, number[]>();
  for (let arcIndex = 0; arcIndex < arcCount; arcIndex += 1) {
    const base = arcIndex * WALL_STRIDE;
    const pair: [string, string] = [
      endpointKey(arcs[base], arcs[base + 1]),
      endpointKey(arcs[base + 2], arcs[base + 3])
    ];
    keys[arcIndex] = pair;
    for (const key of pair) {
      const indexes = arcsByEndpoint.get(key);
      if (indexes) {
        indexes.push(arcIndex);
      } else {
        arcsByEndpoint.set(key, [arcIndex]);
      }
    }
  }

  const visited = new Uint8Array(arcCount);
  const kept: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < arcCount; start += 1) {
    if (visited[start] !== 0) {
      continue;
    }
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    const component: number[] = [];
    const degree = new Map<string, number>();
    const coordinateByKey = new Map<string, { x: number; y: number }>();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    while (stack.length > 0) {
      const arcIndex = stack.pop() as number;
      component.push(arcIndex);
      const base = arcIndex * WALL_STRIDE;
      const pair = keys[arcIndex];
      const coordinates = [
        { x: arcs[base], y: arcs[base + 1] },
        { x: arcs[base + 2], y: arcs[base + 3] }
      ];
      for (let end = 0; end < 2; end += 1) {
        const key = pair[end];
        const point = coordinates[end];
        degree.set(key, (degree.get(key) ?? 0) + 1);
        coordinateByKey.set(key, point);
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
        for (const neighbor of arcsByEndpoint.get(key) ?? []) {
          if (visited[neighbor] === 0) {
            visited[neighbor] = 1;
            stack.push(neighbor);
          }
        }
      }
    }

    const openEndpoints: { x: number; y: number }[] = [];
    let branched = false;
    for (const [key, count] of degree) {
      if (count === 1) {
        openEndpoints.push(coordinateByKey.get(key) as { x: number; y: number });
      } else if (count !== 2) {
        branched = true;
      }
    }
    // A door swing is an open chain. Closed loops and branched curved symbols are not.
    if (branched || openEndpoints.length !== 2) {
      continue;
    }

    const span = Math.hypot(maxX - minX, maxY - minY);
    if (span < Math.max(1.5 * wallWidth, 0.08 * doorGapMax) || span > 1.35 * doorGapMax) {
      continue;
    }

    const attachmentRadius = Math.max(2.5 * wallWidth, 0.18 * doorGapMax);
    let attached = false;
    for (const endpoint of openEndpoints) {
      grid.forEachNear(endpoint.x, endpoint.y, attachmentRadius, (wallIndex) => {
        const base = wallIndex * WALL_STRIDE;
        const reach = attachmentRadius + walls[base + 4];
        if (distanceToSegmentSquared(endpoint.x, endpoint.y, walls[base], walls[base + 1], walls[base + 2], walls[base + 3]) <= reach * reach) {
          attached = true;
          return false;
        }
      });
      if (attached) {
        break;
      }
    }
    if (!attached) {
      continue;
    }

    for (const arcIndex of component) {
      const base = arcIndex * WALL_STRIDE;
      kept.push(arcs[base], arcs[base + 1], arcs[base + 2], arcs[base + 3], arcs[base + 4]);
    }
  }
  return new Float64Array(kept);
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
  extendedDoorGapMax: number,
  doorArcs: Float64Array,
  raster: WhiskerRaster
): number[] {
  const closures: number[] = [];
  const localTouchPad = 0.25 * wallWidth;
  const capMaxLength = Math.max(5 * wallWidth, 0.5 * doorGapMax);
  const { occupancy, width, height, scale } = raster;
  // Collinear contacts (the wall continuing on the far side of the gap, e.g. window
  // sections) may be bridged across larger gaps than transversal contacts (door jambs),
  // which stay within the door-gap limit to avoid cutting corridors. The page-relative
  // ceiling prevents a small inferred door scale from authorizing cross-sheet bridges.
  const ordinaryCollinearGapMax = 2.5 * doorGapMax;
  const supportedCollinearGapMax = Math.min(14 * doorGapMax, (0.16 * Math.hypot(width, height)) / scale);
  const collinearAlignmentMin = Math.cos((15 * Math.PI) / 180);

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
      const maxMarchPx = Math.max(supportedCollinearGapMax, extendedDoorGapMax) * scale + initialRunLimitPx;
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
        const contactWorldX = px + dirX * (contactPx / scale);
        const contactWorldY = py + dirY * (contactPx / scale);
        // A context-checked swing arc attached to either jamb permits a longer
        // transversal bridge. Without that evidence, retain the old conservative rule:
        // only a roughly collinear continuation (typically a window section) may span
        // beyond the nominal door scale.
        let extendedDoor = false;
        if (gapWorld <= extendedDoorGapMax && doorArcs.length > 0) {
          const attachmentRadiusSquared = Math.max(3 * wallWidth, 0.2 * extendedDoorGapMax) ** 2;
          for (let arcBase = 0; arcBase + 4 < doorArcs.length; arcBase += WALL_STRIDE) {
            for (let arcEnd = 0; arcEnd < 2; arcEnd += 1) {
              const arcX = doorArcs[arcBase + arcEnd * 2];
              const arcY = doorArcs[arcBase + arcEnd * 2 + 1];
              if (
                Math.min(
                  (arcX - px) ** 2 + (arcY - py) ** 2,
                  (arcX - contactWorldX) ** 2 + (arcY - contactWorldY) ** 2
                ) <= attachmentRadiusSquared
              ) {
                extendedDoor = true;
                break;
              }
            }
            if (extendedDoor) {
              break;
            }
          }
        }
        if (extendedDoor) {
          const extendWorld = (contactPx + 2) / scale;
          closures.push(px, py, px + dirX * extendWorld, py + dirY * extendWorld, ownHalfWidth);
          continue;
        }
        if (gapWorld > supportedCollinearGapMax) {
          continue;
        }
        // Allow other long bridges only toward roughly collinear walls (window sections).
        let collinear = false;
        let collinearWallIndex = -1;
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
            collinearWallIndex = wallIndex;
          }
        });
        const supportedLongGap = gapWorld > ordinaryCollinearGapMax;
        if (!collinear || (supportedLongGap && length < 1.2 * gapWorld)) {
          continue;
        }
        if (supportedLongGap) {
          // A long opening between similarly sized wall stubs is more likely an
          // intentional exterior/circulation opening than a missing window or shell
          // section. The backing-length test above handles that case. Also avoid
          // capping shallow U-shaped wall bays: those produce convincing rectangular
          // pockets but are wall recesses, not rooms.
          const bridgeLength = contactPx / scale;
          const bridgeMidX = px + 0.5 * dirX * bridgeLength;
          const bridgeMidY = py + 0.5 * dirY * bridgeLength;
          const maxBayDepth = 0.75 * bridgeLength;
          const queryRadius = Math.hypot(0.5 * bridgeLength, maxBayDepth) + maxWallHalfWidth;
          let shallowBay = false;
          grid.forEachNear(bridgeMidX, bridgeMidY, queryRadius, (wallIndex) => {
            if (wallIndex === i || wallIndex === collinearWallIndex) {
              return;
            }
            const wallBase = wallIndex * WALL_STRIDE;
            const x0 = walls[wallBase];
            const y0 = walls[wallBase + 1];
            const x1 = walls[wallBase + 2];
            const y1 = walls[wallBase + 3];
            const otherLength = Math.hypot(x1 - x0, y1 - y0);
            if (!(otherLength > 0)) {
              return;
            }
            const alignment = Math.abs(((x1 - x0) * dirX + (y1 - y0) * dirY) / otherLength);
            if (alignment < collinearAlignmentMin) {
              return;
            }
            const along0 = (x0 - px) * dirX + (y0 - py) * dirY;
            const along1 = (x1 - px) * dirX + (y1 - py) * dirY;
            const overlap = Math.min(bridgeLength, Math.max(along0, along1)) - Math.max(0, Math.min(along0, along1));
            if (overlap < 0.8 * bridgeLength) {
              return;
            }
            const wallMidX = 0.5 * (x0 + x1);
            const wallMidY = 0.5 * (y0 + y1);
            const normalDistance = Math.abs((wallMidX - bridgeMidX) * -dirY + (wallMidY - bridgeMidY) * dirX);
            if (normalDistance > 2 * wallWidth && normalDistance < maxBayDepth) {
              shallowBay = true;
              return false;
            }
          });
          if (shallowBay) {
            continue;
          }
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
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Scanline flood fill of free pixels (occupancy 0, region 0) writing `regionId`.
 * The whole connected component is always labeled and measured before semantic filters
 * run; stopping at an area threshold would leave a painted prefix that acts as an
 * artificial barrier and fabricates new components for later seeds.
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
  exteriorId: number,
  closureMask: Uint8Array | null = null
): FloodFillResult {
  const result: FloodFillResult = {
    pixelCount: 0,
    touchedBorder: false,
    touchedDoor: false,
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
  const miterLimit = 3 * Math.abs(distance);
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
    if (cosHalf > 1e-6 && Math.abs(distance) / cosHalf <= miterLimit) {
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
 * When geometry-backed text items are available, the larger text scale wins first:
 * architectural room labels are commonly set larger than equipment schedules/tags.
 * Digit+letter tokens then win over digits-only tokens; label order breaks ties.
 */
function pickRoomNumber(labelTexts: string[], labels: SceneTextItem[] = []): string {
  let bestCandidate = "";
  let bestScale = Number.NEGATIVE_INFINITY;
  let bestHasSuffix = false;
  for (let labelIndex = 0; labelIndex < labelTexts.length; labelIndex += 1) {
    const text = labelTexts[labelIndex];
    const item = labels[labelIndex];
    // The smaller box dimension approximates font size for both horizontal and rotated
    // labels; the larger dimension mostly measures token length.
    const labelScale = item
      ? Math.min(Math.max(0, item.maxX - item.minX), Math.max(0, item.maxY - item.minY))
      : 0;
    for (const rawToken of text.split(/\s+/)) {
      // Measurement annotations are not room numbers: signed offsets (+45), imperial
      // marks (45" / 6'), percentages, degrees.
      if (/^[+-]/.test(rawToken) || /["'′″°%]/.test(rawToken)) {
        continue;
      }
      const token = rawToken.replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, "");
      const hasSuffix = /^\d{1,6}[-.]?[A-Za-z]{1,2}$/.test(token);
      if (!hasSuffix && !/^\d{2,6}$/.test(token)) {
        continue;
      }
      const sameScale = Math.abs(labelScale - bestScale) <= 1e-6;
      if (
        bestCandidate === "" ||
        labelScale > bestScale + 1e-6 ||
        (sameScale && hasSuffix && !bestHasSuffix)
      ) {
        bestCandidate = token;
        bestScale = labelScale;
        bestHasSuffix = hasSuffix;
      }
    }
  }
  return bestCandidate;
}

/**
 * Room labels are room numbers (1612A, 60C06, 200, S2) or room-name words (CORRIDOR,
 * HALL); electrical/dimension annotations (GFI, J, DM, +45", 15.26 SF) are not.
 */
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

/** Whether `text` contains the exact alphanumeric token selected as the room number. */
function labelContainsRoomNumber(text: string, roomNumber: string): boolean {
  if (!roomNumber) {
    return false;
  }
  const expected = roomNumber.toUpperCase();
  return text.split(/\s+/).some((rawToken) => {
    const token = rawToken.replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, "");
    return token.toUpperCase() === expected;
  });
}

interface OpenBayAxisRun {
  coordinate: number;
  start: number;
  end: number;
}

interface OpenBaySideMetrics {
  coverage: number;
  largestGap: number;
}

interface OpenBayBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const OPEN_BAY_LABEL_PATTERN =
  /\b(?:ALCOVE|WAITING|RECEPTION|LOUNGE|WORK AREA|WORK STATION|NURSE STATION|OPEN OFFICE|PATIENT BAY|CHECK IN|WEIGH IN)\b/;

function isOpenBayLabel(text: string): boolean {
  const normalized = text.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return OPEN_BAY_LABEL_PATTERN.test(normalized);
}

/** Merge interval coverage and measure the largest unsupported part of one wall side. */
function measureOpenBaySide(
  runs: OpenBayAxisRun[],
  coordinate: number,
  start: number,
  end: number,
  coordinateTolerance: number,
  intervalTolerance: number
): OpenBaySideMetrics {
  const intervals: [number, number][] = [];
  for (const run of runs) {
    if (Math.abs(run.coordinate - coordinate) > coordinateTolerance) {
      continue;
    }
    const lo = Math.max(start, run.start - intervalTolerance);
    const hi = Math.min(end, run.end + intervalTolerance);
    if (hi > lo) {
      intervals.push([lo, hi]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);

  let covered = 0;
  let largestGap = 0;
  let cursor = start;
  for (const interval of intervals) {
    const lo = Math.max(cursor, interval[0]);
    if (interval[0] > cursor) {
      largestGap = Math.max(largestGap, interval[0] - cursor);
    }
    if (interval[1] > lo) {
      covered += interval[1] - lo;
      cursor = interval[1];
    }
  }
  largestGap = Math.max(largestGap, end - cursor);
  return {
    coverage: covered / Math.max(1e-9, end - start),
    largestGap
  };
}

function dedupeOpenBayCoordinates(values: number[], tolerance: number): number[] {
  values.sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of values) {
    if (result.length === 0 || value - result[result.length - 1] > tolerance) {
      result.push(value);
    }
  }
  return result;
}

function openBayPointHasAxisSupport(
  horizontalRuns: OpenBayAxisRun[],
  verticalRuns: OpenBayAxisRun[],
  x: number,
  y: number,
  coordinateTolerance: number,
  endpointTolerance: number
): boolean {
  return (
    horizontalRuns.some(
      (run) =>
        Math.abs(run.coordinate - y) <= coordinateTolerance &&
        x >= run.start - endpointTolerance &&
        x <= run.end + endpointTolerance
    ) ||
    verticalRuns.some(
      (run) =>
        Math.abs(run.coordinate - x) <= coordinateTolerance &&
        y >= run.start - endpointTolerance &&
        y <= run.end + endpointTolerance
    )
  );
}

function openBayBoundsPolygon(bounds: OpenBayBounds): Float32Array {
  return new Float32Array([
    bounds.left,
    bounds.top,
    bounds.right,
    bounds.top,
    bounds.right,
    bounds.bottom,
    bounds.left,
    bounds.bottom
  ]);
}

function openBaySampleContainment(bounds: OpenBayBounds, polygon: ArrayLike<number>): number {
  let inside = 0;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  for (let row = 1; row <= 5; row += 1) {
    for (let column = 1; column <= 5; column += 1) {
      if (
        pointInPolygon(
          bounds.left + (width * column) / 6,
          bounds.top + (height * row) / 6,
          polygon
        )
      ) {
        inside += 1;
      }
    }
  }
  return inside / 25;
}

function openBayPolygonAxisDistance(
  polygon: ArrayLike<number>,
  horizontal: boolean,
  coordinate: number,
  spanStart: number,
  spanEnd: number
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < polygon.length; i += 2) {
    const j = (i + 2) % polygon.length;
    const x0 = polygon[i];
    const y0 = polygon[i + 1];
    const x1 = polygon[j];
    const y1 = polygon[j + 1];
    if (horizontal) {
      if (Math.abs(y1 - y0) > 0.15 * Math.abs(x1 - x0) || Math.max(x0, x1) < spanStart || Math.min(x0, x1) > spanEnd) {
        continue;
      }
      best = Math.min(best, Math.abs((y0 + y1) / 2 - coordinate));
    } else {
      if (Math.abs(x1 - x0) > 0.15 * Math.abs(y1 - y0) || Math.max(y0, y1) < spanStart || Math.min(y0, y1) > spanEnd) {
        continue;
      }
      best = Math.min(best, Math.abs((x0 + x1) / 2 - coordinate));
    }
  }
  return best;
}

/** Snap a structural centerline coordinate onto the nearby face of the leaked contour. */
function snapOpenBayCoordinateToPolygon(
  polygon: ArrayLike<number>,
  horizontal: boolean,
  coordinate: number,
  spanStart: number,
  spanEnd: number,
  tolerance: number
): number {
  let best = coordinate;
  let bestDistance = tolerance;
  for (let i = 0; i + 1 < polygon.length; i += 2) {
    const x = polygon[i];
    const y = polygon[i + 1];
    const along = horizontal ? x : y;
    const candidate = horizontal ? y : x;
    const distance = Math.abs(candidate - coordinate);
    if (along >= spanStart - tolerance && along <= spanEnd + tolerance && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function labelsFitOpenBay(labels: SceneTextItem[], bounds: OpenBayBounds, tolerance: number): boolean {
  return labels.every(
    (label) =>
      label.minX >= bounds.left - tolerance &&
      label.maxX <= bounds.right + tolerance &&
      label.minY >= bounds.top - tolerance &&
      label.maxY <= bounds.bottom + tolerance
  );
}

/**
 * Replace a leaked, equipment-shaped contour with a label-owned three-sided structural
 * bay. This deliberately handles only decisive axis-aligned cases: generic contour
 * cleanup remains the responsibility of the topology-safe structural trace.
 */
function refineLabelBackedOpenBays(
  rooms: DetectedRoom[],
  dominantLongWalls: Float64Array,
  doorGapMax: number
): number {
  if (!(doorGapMax > 0) || dominantLongWalls.length < 3 * WALL_STRIDE) {
    return 0;
  }

  const horizontalRuns: OpenBayAxisRun[] = [];
  const verticalRuns: OpenBayAxisRun[] = [];
  for (let i = 0; i + 4 < dominantLongWalls.length; i += WALL_STRIDE) {
    const x0 = dominantLongWalls[i];
    const y0 = dominantLongWalls[i + 1];
    const x1 = dominantLongWalls[i + 2];
    const y1 = dominantLongWalls[i + 3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (Math.abs(dy) <= 0.08 * Math.abs(dx)) {
      horizontalRuns.push({ coordinate: (y0 + y1) / 2, start: Math.min(x0, x1), end: Math.max(x0, x1) });
    } else if (Math.abs(dx) <= 0.08 * Math.abs(dy)) {
      verticalRuns.push({ coordinate: (x0 + x1) / 2, start: Math.min(y0, y1), end: Math.max(y0, y1) });
    }
  }
  if (horizontalRuns.length === 0 || verticalRuns.length === 0) {
    return 0;
  }

  const coordinateTolerance = 0.03 * doorGapMax;
  const intervalTolerance = 0.02 * doorGapMax;
  const coordinateDedupeTolerance = 0.01 * doorGapMax;
  const endpointTolerance = 0.2 * doorGapMax;
  const minExtent = 0.9 * doorGapMax;
  const maxExtent = 5.5 * doorGapMax;
  const anchorClearance = 0.25 * doorGapMax;
  const labelTolerance = 0.05 * doorGapMax;
  const polygonFaceTolerance = 0.2 * doorGapMax;
  const snapTolerance = 0.1 * doorGapMax;
  let refinementCount = 0;

  for (const room of rooms) {
    if (
      !room.roomNumber ||
      !/\d/.test(room.roomNumber) ||
      !isOpenBayLabel(room.labelText) ||
      room.polygon.length / 2 < 12 ||
      !room.labels.some((label) => labelContainsRoomNumber(label.text, room.roomNumber))
    ) {
      continue;
    }

    const polygonXs: number[] = [];
    const polygonYs: number[] = [];
    for (let i = 0; i + 1 < room.polygon.length; i += 2) {
      const j = (i + 2) % room.polygon.length;
      const x0 = room.polygon[i];
      const y0 = room.polygon[i + 1];
      const x1 = room.polygon[j];
      const y1 = room.polygon[j + 1];
      if (Math.abs(x1 - x0) <= 0.15 * Math.abs(y1 - y0)) {
        polygonXs.push((x0 + x1) / 2);
      }
      if (Math.abs(y1 - y0) <= 0.15 * Math.abs(x1 - x0)) {
        polygonYs.push((y0 + y1) / 2);
      }
    }

    const xs = dedupeOpenBayCoordinates(
      verticalRuns
        .filter(
          (run) =>
            run.end >= room.labelY - maxExtent &&
            run.start <= room.labelY + maxExtent &&
            Math.abs(run.coordinate - room.labelX) <= maxExtent &&
            polygonXs.some((coordinate) => Math.abs(coordinate - run.coordinate) <= polygonFaceTolerance)
        )
        .map((run) => run.coordinate),
      coordinateDedupeTolerance
    );
    const ys = dedupeOpenBayCoordinates(
      horizontalRuns
        .filter(
          (run) =>
            run.end >= room.labelX - maxExtent &&
            run.start <= room.labelX + maxExtent &&
            Math.abs(run.coordinate - room.labelY) <= maxExtent &&
            polygonYs.some((coordinate) => Math.abs(coordinate - run.coordinate) <= polygonFaceTolerance)
        )
        .map((run) => run.coordinate),
      coordinateDedupeTolerance
    );
    const lefts = xs.filter((x) => x < room.labelX - anchorClearance).sort((a, b) => b - a).slice(0, 10);
    const rights = xs.filter((x) => x > room.labelX + anchorClearance).sort((a, b) => a - b).slice(0, 10);
    const tops = ys.filter((y) => y < room.labelY - anchorClearance).sort((a, b) => b - a).slice(0, 10);
    const bottoms = ys.filter((y) => y > room.labelY + anchorClearance).sort((a, b) => a - b).slice(0, 10);

    let bestBounds: OpenBayBounds | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const left of lefts) {
      for (const right of rights) {
        const width = right - left;
        if (width < minExtent || width > maxExtent) {
          continue;
        }
        for (const top of tops) {
          for (const bottom of bottoms) {
            const height = bottom - top;
            if (height < minExtent || height > maxExtent) {
              continue;
            }
            const bounds = { left, top, right, bottom };
            const area = width * height;
            const areaRatio = area / Math.max(room.area, 1e-9);
            if (areaRatio < 0.08 || areaRatio > 0.55 || !labelsFitOpenBay(room.labels, bounds, labelTolerance)) {
              continue;
            }

            const sides = [
              measureOpenBaySide(horizontalRuns, top, left, right, coordinateTolerance, intervalTolerance),
              measureOpenBaySide(verticalRuns, right, top, bottom, coordinateTolerance, intervalTolerance),
              measureOpenBaySide(horizontalRuns, bottom, left, right, coordinateTolerance, intervalTolerance),
              measureOpenBaySide(verticalRuns, left, top, bottom, coordinateTolerance, intervalTolerance)
            ];
            const openSideIndexes = sides
              .map((side, index) => ({ side, index }))
              .filter(({ side }) => side.largestGap > 1.9 * doorGapMax);
            if (openSideIndexes.length !== 1) {
              continue;
            }
            const openSideIndex = openSideIndexes[0].index;
            const openSide = sides[openSideIndex];
            const supportedSides = sides.filter((_, index) => index !== openSideIndex);
            if (
              openSide.largestGap < 2.4 * doorGapMax ||
              openSide.coverage > 0.15 ||
              supportedSides.reduce((sum, side) => sum + side.coverage, 0) < 1.65 ||
              Math.max(...supportedSides.map((side) => side.coverage)) < 0.85
            ) {
              continue;
            }

            const cornersSupported =
              openBayPointHasAxisSupport(horizontalRuns, verticalRuns, left, top, coordinateTolerance, endpointTolerance) &&
              openBayPointHasAxisSupport(horizontalRuns, verticalRuns, right, top, coordinateTolerance, endpointTolerance) &&
              openBayPointHasAxisSupport(horizontalRuns, verticalRuns, right, bottom, coordinateTolerance, endpointTolerance) &&
              openBayPointHasAxisSupport(horizontalRuns, verticalRuns, left, bottom, coordinateTolerance, endpointTolerance);
            if (!cornersSupported || openBaySampleContainment(bounds, room.polygon) < 0.72) {
              continue;
            }

            let containedAnchors = 0;
            let overlapsAnotherRoom = false;
            const candidatePolygon = openBayBoundsPolygon(bounds);
            const candidateBounds = polygonBounds(candidatePolygon);
            for (const other of rooms) {
              if (
                other.labelX > left &&
                other.labelX < right &&
                other.labelY > top &&
                other.labelY < bottom
              ) {
                containedAnchors += 1;
              }
              if (other !== room) {
                const otherBounds = polygonBounds(other.polygon);
                if (
                  boundsHaveInteriorIntersection(candidateBounds, otherBounds, 1e-9) &&
                  polygonsHavePositiveAreaOverlap(candidatePolygon, other.polygon, candidateBounds, otherBounds, 1e-9)
                ) {
                  overlapsAnotherRoom = true;
                }
              }
            }
            if (containedAnchors !== 1 || overlapsAnotherRoom) {
              continue;
            }

            const sideDefinitions: [boolean, number, number, number][] = [
              [true, top, left, right],
              [false, right, top, bottom],
              [true, bottom, left, right],
              [false, left, top, bottom]
            ];
            const faceScore = sideDefinitions.reduce((sum, [horizontal, coordinate, start, end]) => {
              const distance = openBayPolygonAxisDistance(room.polygon, horizontal, coordinate, start, end);
              return sum + Math.max(0, 1 - distance / polygonFaceTolerance);
            }, 0);
            const supportedCoverage = supportedSides.reduce((sum, side) => sum + side.coverage, 0);
            const gapQuality = supportedSides.reduce(
              (sum, side) => sum + Math.max(0, 1 - side.largestGap / (1.9 * doorGapMax)),
              0
            );
            const score = 2 * supportedCoverage + gapQuality + 0.3 * faceScore - 0.1 * areaRatio;
            if (score > bestScore) {
              bestScore = score;
              bestBounds = bounds;
            }
          }
        }
      }
    }

    if (!bestBounds) {
      continue;
    }
    const snapped: OpenBayBounds = {
      left: snapOpenBayCoordinateToPolygon(room.polygon, false, bestBounds.left, bestBounds.top, bestBounds.bottom, snapTolerance),
      top: snapOpenBayCoordinateToPolygon(room.polygon, true, bestBounds.top, bestBounds.left, bestBounds.right, snapTolerance),
      right: snapOpenBayCoordinateToPolygon(room.polygon, false, bestBounds.right, bestBounds.top, bestBounds.bottom, snapTolerance),
      bottom: snapOpenBayCoordinateToPolygon(room.polygon, true, bestBounds.bottom, bestBounds.left, bestBounds.right, snapTolerance)
    };
    const replacement = openBayBoundsPolygon(snapped);
    const replacementArea = signedPolygonArea(replacement);
    const replacementBounds = polygonBounds(replacement);
    let replacementOverlapsAnotherRoom = false;
    let replacementAnchorCount = 0;
    for (const other of rooms) {
      if (
        other.labelX > snapped.left &&
        other.labelX < snapped.right &&
        other.labelY > snapped.top &&
        other.labelY < snapped.bottom
      ) {
        replacementAnchorCount += 1;
      }
      if (other === room) {
        continue;
      }
      const otherBounds = polygonBounds(other.polygon);
      if (
        boundsHaveInteriorIntersection(replacementBounds, otherBounds, 1e-9) &&
        polygonsHavePositiveAreaOverlap(replacement, other.polygon, replacementBounds, otherBounds, 1e-9)
      ) {
        replacementOverlapsAnotherRoom = true;
        break;
      }
    }
    if (
      !(replacementArea > 0) ||
      replacementAnchorCount !== 1 ||
      replacementOverlapsAnotherRoom ||
      !labelsFitOpenBay(room.labels, snapped, labelTolerance) ||
      openBaySampleContainment(snapped, room.polygon) < 0.72
    ) {
      continue;
    }
    room.polygon = replacement;
    room.area = replacementArea;
    refinementCount += 1;
  }
  return refinementCount;
}

/** Text that identifies a sheet/view/title-block cell rather than an architectural space. */
function isSheetAnnotationLabel(text: string): boolean {
  const normalized = text.trim().toUpperCase().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return false;
  }
  // Protect common room nouns when a project genuinely names a room with a word such as
  // PLAN or DETAIL (for example, "PLAN REVIEW OFFICE").
  if (/\b(ROOM|OFFICE|CORRIDOR|HALL|LOBBY|TOILET|RESTROOM|STAIR|SHAFT|RISER|CLOSET|STORAGE|ELEVATOR)\b/.test(normalized)) {
    return false;
  }
  return /\b(PLAN|SECTION|ELEVATION|DETAIL|SHEET|DRAWING|DOCUMENTS?|ISSUE|REVISION|LEGEND|NOTES?|SCALE)\b/.test(normalized);
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
 * Union watershed groups that are too small to be emitted into their strongest
 * adjacent group. Leaving their pixels assigned to a rejected child would carve a
 * synthetic hole/frontier into an otherwise valid neighboring room.
 */
function mergeUndersizedWatershedGroups(
  groupOf: Int32Array,
  fills: WatershedFill[],
  frontiers: Map<number, { lengthPx: number; maxClearance: number }>,
  minPixels: number
): Uint8Array {
  const absorbedClusters = new Uint8Array(groupOf.length);
  const findGroup = (clusterIndex: number): number => {
    let root = clusterIndex;
    while (groupOf[root] !== root) {
      root = groupOf[root];
    }
    while (groupOf[clusterIndex] !== root) {
      const next = groupOf[clusterIndex];
      groupOf[clusterIndex] = root;
      clusterIndex = next;
    }
    return root;
  };

  for (let pass = 0; pass < groupOf.length; pass += 1) {
    const pixelsByRoot = new Map<number, number>();
    for (let clusterIndex = 0; clusterIndex < groupOf.length; clusterIndex += 1) {
      const root = findGroup(clusterIndex);
      pixelsByRoot.set(root, (pixelsByRoot.get(root) ?? 0) + fills[clusterIndex].pixelCount);
    }
    if (pixelsByRoot.size <= 1) {
      return absorbedClusters;
    }

    let undersizedRoot = -1;
    let undersizedPixels = Number.POSITIVE_INFINITY;
    for (const [root, pixels] of pixelsByRoot) {
      if (pixels < minPixels && pixels < undersizedPixels) {
        undersizedRoot = root;
        undersizedPixels = pixels;
      }
    }
    if (undersizedRoot < 0) {
      return absorbedClusters;
    }

    const sharedByRoot = new Map<number, number>();
    for (const [key, frontier] of frontiers) {
      const left = findGroup(Math.floor(key / 4096));
      const right = findGroup(key % 4096);
      if (left === right) {
        continue;
      }
      if (left === undersizedRoot) {
        sharedByRoot.set(right, (sharedByRoot.get(right) ?? 0) + frontier.lengthPx);
      } else if (right === undersizedRoot) {
        sharedByRoot.set(left, (sharedByRoot.get(left) ?? 0) + frontier.lengthPx);
      }
    }

    let targetRoot = -1;
    let targetFrontier = -1;
    let targetPixels = -1;
    for (const [root, sharedLength] of sharedByRoot) {
      const pixels = pixelsByRoot.get(root) ?? 0;
      if (sharedLength > targetFrontier || (sharedLength === targetFrontier && pixels > targetPixels)) {
        targetRoot = root;
        targetFrontier = sharedLength;
        targetPixels = pixels;
      }
    }
    if (targetRoot < 0) {
      return absorbedClusters;
    }
    // Record which seed clusters were rejected on size before changing their root.
    // Callers can keep their labels out of the surviving room's primary metadata even
    // though their pixels are deliberately repainted into it.
    for (let clusterIndex = 0; clusterIndex < groupOf.length; clusterIndex += 1) {
      if (findGroup(clusterIndex) === undersizedRoot) {
        absorbedClusters[clusterIndex] = 1;
      }
    }
    groupOf[undersizedRoot] = targetRoot;
  }
  return absorbedClusters;
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

interface PolygonBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function findRegionMemberPixel(
  regionMap: Uint16Array,
  width: number,
  height: number,
  regionId: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
): number {
  const minX = Math.max(0, Math.floor(bounds.minX));
  const minY = Math.max(0, Math.floor(bounds.minY));
  const maxX = Math.min(width - 1, Math.ceil(bounds.maxX));
  const maxY = Math.min(height - 1, Math.ceil(bounds.maxY));
  for (let y = minY; y <= maxY; y += 1) {
    const rowBase = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const index = rowBase + x;
      if (regionMap[index] === regionId) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Find output candidates that violate the mutually-exclusive room-cell invariant.
 *
 * Raster regions cannot overlap, but a region surrounding holes is currently exposed as
 * one outer ring. That ring can cover many valid inner rooms (a "super room"). Usually
 * the outer ring must be suppressed. The exception is a room-labeled outer region whose
 * contained candidates are all unlabeled: those inner pockets are typically closed
 * tables, casework, or furniture symbols inside a legitimate large room.
 */
function findRoomConflictSuppressions(
  rooms: DetectedRoom[],
  rasterContours: number[][],
  memberPixels: number[],
  rasterWidth: number
): Map<number, "containsRoom"> {
  const suppressed = new Map<number, "containsRoom">();
  const count = Math.min(rooms.length, rasterContours.length, memberPixels.length);
  if (count < 2) {
    return suppressed;
  }

  const bounds = rasterContours.map((contour) => polygonBounds(contour));
  const roomLike = rooms.map((room) => {
    const texts = room.labels.length > 0 ? room.labels.map((item) => item.text) : room.labelText.split("\n");
    return texts.some((text) => isRoomLikeLabel(text));
  });
  const containedByOuter: number[][] = Array.from({ length: count }, () => []);
  for (let outer = 0; outer < count; outer += 1) {
    const contour = rasterContours[outer];
    for (let inner = 0; inner < count; inner += 1) {
      if (inner === outer || memberPixels[inner] < 0) {
        continue;
      }
      const memberX = (memberPixels[inner] % rasterWidth) + 0.5;
      const memberY = Math.floor(memberPixels[inner] / rasterWidth) + 0.5;
      const outerBounds = bounds[outer];
      if (
        memberX > outerBounds.minX &&
        memberX < outerBounds.maxX &&
        memberY > outerBounds.minY &&
        memberY < outerBounds.maxY &&
        pointInPolygon(memberX, memberY, contour)
      ) {
        containedByOuter[outer].push(inner);
      }
    }
  }
  for (let outer = 0; outer < count; outer += 1) {
    const contained = containedByOuter[outer];
    if (contained.length === 0) {
      continue;
    }
    if (roomLike[outer] && contained.every((inner) => !roomLike[inner])) {
      for (const inner of contained) {
        suppressed.set(inner, "containsRoom");
      }
    } else {
      suppressed.set(outer, "containsRoom");
    }
  }
  return suppressed;
}

function polygonBounds(polygon: ArrayLike<number>): PolygonBounds {
  const bounds: PolygonBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i + 1 < polygon.length; i += 2) {
    bounds.minX = Math.min(bounds.minX, polygon[i]);
    bounds.minY = Math.min(bounds.minY, polygon[i + 1]);
    bounds.maxX = Math.max(bounds.maxX, polygon[i]);
    bounds.maxY = Math.max(bounds.maxY, polygon[i + 1]);
  }
  return bounds;
}

/** Even-odd fill test matching the simple-ring rendering/evaluation convention. */
function pointInPolygon(x: number, y: number, polygon: ArrayLike<number>): boolean {
  let inside = false;
  const vertexCount = polygon.length / 2;
  for (let i = 0, j = vertexCount - 1; i < vertexCount; j = i, i += 1) {
    const ix = polygon[i * 2];
    const iy = polygon[i * 2 + 1];
    const jx = polygon[j * 2];
    const jy = polygon[j * 2 + 1];
    if ((iy > y) !== (jy > y) && x < ((jx - ix) * (y - iy)) / (jy - iy) + ix) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Remove one decisive narrow-mouth furniture detour per room along an independently
 * paired structural wall. The shortcut is accepted only when it follows that wall's
 * room-facing side, adds a modest obstacle-sized area, preserves every label, remains
 * simple, and stays disjoint from all other rooms.
 */
function repairPairedWallFurnitureNotches(
  rooms: DetectedRoom[],
  recoveredWalls: number[],
  pairedStructuralWalls: number[],
  doorGapMax: number
): number {
  const recoveredWallCount = recoveredWalls.length / WALL_STRIDE;
  const structuralWallCount = pairedStructuralWalls.length / WALL_STRIDE;
  if (rooms.length === 0 || (recoveredWallCount === 0 && structuralWallCount === 0) || !(doorGapMax > 0)) {
    return 0;
  }

  const epsilon = 1e-9;
  const faceTolerance = 0.2 * doorGapMax;
  const maxMouth = 1.1 * doorGapMax;
  // Door-sized mouths need stronger evidence when the candidate comes from the broad
  // paired-wall hypothesis rather than a door-recovered partition. A very small margin
  // covers quantization/simplification drift around one architectural opening width.
  const maxStructuralMouth = 1.12 * doorGapMax;
  const minStructuralCandidateLength = 6 * doorGapMax;
  const minStructuralOverrun = 2 * doorGapMax;
  const minExcursion = 1.5 * doorGapMax;
  // Require a meaningful obstacle-sized correction. Tiny slivers can arise from
  // ordinary wall-face snapping and should not trigger this specialized repair.
  const minAddedArea = 0.25 * doorGapMax * doorGapMax;
  const maxAddedArea = 6 * doorGapMax * doorGapMax;
  const candidateWalls = [...recoveredWalls, ...pairedStructuralWalls];
  const candidateWallCount = candidateWalls.length / WALL_STRIDE;
  let repairCount = 0;

  const vertexAt = (polygon: ArrayLike<number>, index: number): { x: number; y: number } => ({
    x: polygon[index * 2],
    y: polygon[index * 2 + 1]
  });
  const pathIndexes = (vertexCount: number, first: number, second: number, forward: boolean): number[] => {
    const indexes: number[] = [];
    if (forward) {
      for (let index = first; index <= second; index += 1) {
        indexes.push(index);
      }
    } else {
      for (let index = second; index < vertexCount; index += 1) {
        indexes.push(index);
      }
      for (let index = 0; index <= first; index += 1) {
        indexes.push(index);
      }
    }
    return indexes;
  };
  const shortcutPolygon = (
    polygon: ArrayLike<number>,
    first: number,
    second: number,
    removeForward: boolean
  ): Float64Array => {
    const vertexCount = polygon.length / 2;
    const values: number[] = [];
    if (removeForward) {
      for (let index = 0; index <= first; index += 1) {
        values.push(polygon[index * 2], polygon[index * 2 + 1]);
      }
      for (let index = second; index < vertexCount; index += 1) {
        values.push(polygon[index * 2], polygon[index * 2 + 1]);
      }
    } else {
      for (let index = first; index <= second; index += 1) {
        values.push(polygon[index * 2], polygon[index * 2 + 1]);
      }
    }
    return new Float64Array(values);
  };

  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
    const room = rooms[roomIndex];
    const polygon = room.polygon;
    const vertexCount = polygon.length / 2;
    if (vertexCount < 12) {
      continue;
    }
    const oldArea = signedPolygonArea(polygon);
    if (!(oldArea > 0)) {
      continue;
    }

    let best: { polygon: Float64Array; area: number; removedVertices: number; detourRatio: number } | null = null;
    for (let wallIndex = 0; wallIndex < candidateWallCount; wallIndex += 1) {
      const wallBase = wallIndex * WALL_STRIDE;
      const x0 = candidateWalls[wallBase];
      const y0 = candidateWalls[wallBase + 1];
      const x1 = candidateWalls[wallBase + 2];
      const y1 = candidateWalls[wallBase + 3];
      const halfWidth = candidateWalls[wallBase + 4];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const length = Math.hypot(dx, dy);
      const broadStructuralCandidate = wallIndex >= recoveredWallCount;
      // Unlike a door-recovered partition, the broad paired set can contain long
      // furniture rails. Require semantic room ownership before it may add floor area.
      if (
        (broadStructuralCandidate && room.labels.length === 0) ||
        length <
        (broadStructuralCandidate ? minStructuralCandidateLength : 3 * doorGapMax)
      ) {
        continue;
      }
      const dirX = dx / length;
      const dirY = dy / length;
      const normX = -dirY;
      const normY = dirX;
      const centerC = x0 * normX + y0 * normY;

      for (const faceSign of [-1, 1]) {
        const faceC = centerC + faceSign * halfWidth;
        const anchorSide = (room.labelX * normX + room.labelY * normY) - faceC;
        if (Math.abs(anchorSide) <= faceTolerance) {
          continue;
        }
        const roomSideSign = Math.sign(anchorSide);
        if (broadStructuralCandidate) {
          let extremeC = roomSideSign > 0 ? Infinity : -Infinity;
          for (let vertex = 0; vertex < vertexCount; vertex += 1) {
            const coordinate = polygon[vertex * 2] * normX + polygon[vertex * 2 + 1] * normY;
            extremeC = roomSideSign > 0 ? Math.min(extremeC, coordinate) : Math.max(extremeC, coordinate);
          }
          if (Math.abs(extremeC - faceC) > faceTolerance) {
            continue;
          }
        }

        for (let first = 0; first < vertexCount; first += 1) {
          const firstPoint = vertexAt(polygon, first);
          const firstT = (firstPoint.x - x0) * dirX + (firstPoint.y - y0) * dirY;
          const firstC = firstPoint.x * normX + firstPoint.y * normY;
          if (
            firstT < -faceTolerance ||
            firstT > length + faceTolerance ||
            Math.abs(firstC - faceC) > faceTolerance
          ) {
            continue;
          }

          for (let second = first + 2; second < vertexCount; second += 1) {
            const secondPoint = vertexAt(polygon, second);
            const secondT = (secondPoint.x - x0) * dirX + (secondPoint.y - y0) * dirY;
            const secondC = secondPoint.x * normX + secondPoint.y * normY;
            const mouth = Math.abs(secondT - firstT);
            const mouthLimit = broadStructuralCandidate ? maxStructuralMouth : maxMouth;
            if (
              secondT < -faceTolerance ||
              secondT > length + faceTolerance ||
              Math.abs(secondC - faceC) > faceTolerance ||
              !(mouth > 0) ||
              mouth > mouthLimit ||
              Math.abs(secondC - firstC) > 0.25 * mouth
            ) {
              continue;
            }
            if (broadStructuralCandidate) {
              const mouthStart = Math.min(firstT, secondT);
              const mouthEnd = Math.max(firstT, secondT);
              if (
                mouthStart < minStructuralOverrun ||
                length - mouthEnd < minStructuralOverrun
              ) {
                continue;
              }
            }

            for (const removeForward of [true, false]) {
              const removedPath = pathIndexes(vertexCount, first, second, removeForward);
              if (removedPath.length < 4 || vertexCount - (removedPath.length - 2) < 3) {
                continue;
              }
              let detourLength = 0;
              let maxExcursion = 0;
              let crossesWall = false;
              for (let pathIndex = 0; pathIndex < removedPath.length; pathIndex += 1) {
                const point = vertexAt(polygon, removedPath[pathIndex]);
                const signedExcursion = ((point.x * normX + point.y * normY) - faceC) * roomSideSign;
                if (signedExcursion < -faceTolerance) {
                  crossesWall = true;
                  break;
                }
                maxExcursion = Math.max(maxExcursion, signedExcursion);
                if (pathIndex > 0) {
                  const previous = vertexAt(polygon, removedPath[pathIndex - 1]);
                  detourLength += Math.hypot(point.x - previous.x, point.y - previous.y);
                }
              }
              if (crossesWall || maxExcursion < minExcursion || detourLength < Math.max(4 * mouth, 6 * doorGapMax)) {
                continue;
              }
              const replacement = shortcutPolygon(polygon, first, second, removeForward);
              const replacementArea = signedPolygonArea(replacement);
              const addedArea = replacementArea - oldArea;
              if (
                replacement.length >= polygon.length - 8 ||
                addedArea < minAddedArea ||
                addedArea > Math.min(0.12 * oldArea, maxAddedArea) ||
                !isSimplePolygon(replacement, epsilon) ||
                !pointInPolygon(room.labelX, room.labelY, replacement) ||
                !room.labels.every((label) =>
                  pointInPolygon((label.minX + label.maxX) / 2, (label.minY + label.maxY) / 2, replacement)
                )
              ) {
                continue;
              }

              const replacementBounds = polygonBounds(replacement);
              let overlapsAnotherRoom = false;
              for (let otherIndex = 0; otherIndex < rooms.length; otherIndex += 1) {
                if (otherIndex === roomIndex) {
                  continue;
                }
                const other = rooms[otherIndex];
                const otherBounds = polygonBounds(other.polygon);
                if (
                  boundsHaveInteriorIntersection(replacementBounds, otherBounds, epsilon) &&
                  polygonsHavePositiveAreaOverlap(replacement, other.polygon, replacementBounds, otherBounds, epsilon)
                ) {
                  overlapsAnotherRoom = true;
                  break;
                }
              }
              if (overlapsAnotherRoom) {
                continue;
              }

              const removedVertices = polygon.length / 2 - replacement.length / 2;
              const detourRatio = detourLength / Math.max(mouth, 1e-9);
              if (
                !best ||
                removedVertices > best.removedVertices ||
                (removedVertices === best.removedVertices && detourRatio > best.detourRatio)
              ) {
                best = { polygon: replacement, area: replacementArea, removedVertices, detourRatio };
              }
            }
          }
        }
      }
    }

    if (best) {
      room.polygon = new Float32Array(best.polygon);
      room.area = best.area;
      repairCount += 1;
    }
  }
  return repairCount;
}

interface PairedWallGeometry {
  index: number;
  x0: number;
  y0: number;
  dirX: number;
  dirY: number;
  normX: number;
  normY: number;
  centerC: number;
  length: number;
  halfWidth: number;
  angle: number;
}

interface PairedWallFaceSupport {
  wall: PairedWallGeometry;
  faceC: number;
  faceDistance: number;
  endpointT: number;
}

/**
 * Remove at most one decisive equipment-shaped detour around an orthogonal paired-wall
 * corner per room. Both replacement legs, and both polygon edges kept beside them,
 * require long paired-wall support. A separate paired diagonal supporting the removed
 * chain is treated as a real chamfer and blocks the repair.
 */
function repairPairedWallOrthogonalCornerDetours(
  rooms: DetectedRoom[],
  pairedWalls: number[],
  doorGapMax: number
): number {
  const pairedWallCount = pairedWalls.length / WALL_STRIDE;
  if (rooms.length === 0 || pairedWallCount < 2 || !(doorGapMax > 0)) {
    return 0;
  }

  const epsilon = 1e-9;
  const faceTolerance = 0.12 * doorGapMax;
  const spanExtension = 0.2 * doorGapMax;
  const keptSpanExtension = 0.2 * doorGapMax;
  const minLegLength = 0.35 * doorGapMax;
  const minStructuralRunLength = 3 * doorGapMax;
  const structuralLengthTolerance = 1e-6 * doorGapMax;
  const maxLegLength = 3 * doorGapMax;
  const maxEndpointDistanceSquared = 2 * maxLegLength * maxLegLength;
  // The two synthetic legs can each approach three door widths. The remaining
  // structural and topology gates keep this wider combined cap from reaching across
  // a room to an unrelated wall pair.
  const maxTotalLegLength = 6 * doorGapMax;
  const minKeptAnchorLength = 0.4 * doorGapMax;
  const minDetourExcursion = 0.25 * doorGapMax;
  const minAddedArea = 0.2 * doorGapMax * doorGapMax;
  const maxAddedArea = 2 * doorGapMax * doorGapMax;
  const perpendicularDotMax = Math.sin((10 * Math.PI) / 180);
  const alignedDotMin = Math.cos((10 * Math.PI) / 180);
  const supportAngleStep = (5 * Math.PI) / 180;
  const supportOffsetStep = 0.06 * doorGapMax;

  const walls: PairedWallGeometry[] = [];
  for (let wallIndex = 0; wallIndex < pairedWallCount; wallIndex += 1) {
    const base = wallIndex * WALL_STRIDE;
    let x0 = pairedWalls[base];
    let y0 = pairedWalls[base + 1];
    let x1 = pairedWalls[base + 2];
    let y1 = pairedWalls[base + 3];
    const halfWidth = pairedWalls[base + 4];
    let dx = x1 - x0;
    let dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (
      length < minStructuralRunLength - structuralLengthTolerance ||
      !(halfWidth > 0) ||
      halfWidth > 0.35 * doorGapMax
    ) {
      continue;
    }
    // Canonicalize the axial direction so face offsets and dedupe keys are stable.
    if (dx < -epsilon || (Math.abs(dx) <= epsilon && dy < 0)) {
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
      dx = -dx;
      dy = -dy;
    }
    const dirX = dx / length;
    const dirY = dy / length;
    const normX = -dirY;
    const normY = dirX;
    let angle = Math.atan2(dirY, dirX);
    if (angle < 0) {
      angle += Math.PI;
    }
    walls.push({
      index: wallIndex,
      x0,
      y0,
      dirX,
      dirY,
      normX,
      normY,
      centerC: x0 * normX + y0 * normY,
      length,
      halfWidth,
      angle
    });
  }
  if (walls.length < 2) {
    return 0;
  }

  const vertexAt = (polygon: ArrayLike<number>, index: number): { x: number; y: number } => ({
    x: polygon[index * 2],
    y: polygon[index * 2 + 1]
  });
  const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;
  const faceForRoom = (wall: PairedWallGeometry, room: DetectedRoom): number => {
    const anchorC = room.labelX * wall.normX + room.labelY * wall.normY;
    return wall.centerC + (anchorC >= wall.centerC ? 1 : -1) * wall.halfWidth;
  };
  const projectOnWall = (wall: PairedWallGeometry, x: number, y: number): number =>
    (x - wall.x0) * wall.dirX + (y - wall.y0) * wall.dirY;
  const spanCoversLeg = (
    wall: PairedWallGeometry,
    endpointT: number,
    cornerT: number,
    largestGapMax = spanExtension
  ): boolean => {
    const minT = Math.min(endpointT, cornerT);
    const maxT = Math.max(endpointT, cornerT);
    const legLength = maxT - minT;
    if (!(legLength > 0)) {
      return false;
    }
    const covered = Math.max(0, Math.min(maxT, wall.length) - Math.max(minT, 0));
    const largestGap = Math.max(0, -minT, maxT - wall.length);
    return covered / legLength >= 0.85 && largestGap <= largestGapMax;
  };
  const replacementPolygon = (
    polygon: ArrayLike<number>,
    first: number,
    second: number,
    removeForward: boolean,
    cornerX: number,
    cornerY: number
  ): Float64Array => {
    const vertexCount = polygon.length / 2;
    const values: number[] = [];
    if (removeForward) {
      for (let index = 0; index <= first; index += 1) {
        values.push(polygon[index * 2], polygon[index * 2 + 1]);
      }
      values.push(cornerX, cornerY);
      for (let index = second; index < vertexCount; index += 1) {
        values.push(polygon[index * 2], polygon[index * 2 + 1]);
      }
    } else {
      for (let index = first; index <= second; index += 1) {
        values.push(polygon[index * 2], polygon[index * 2 + 1]);
      }
      // This point lies between the last and first array vertices on the retained
      // ring, so the implicit closing segment completes B -> corner -> A.
      values.push(cornerX, cornerY);
    }
    return new Float64Array(values);
  };
  const pathIndexes = (vertexCount: number, first: number, second: number, forward: boolean): number[] => {
    const indexes: number[] = [];
    if (forward) {
      for (let index = first; index <= second; index += 1) {
        indexes.push(index);
      }
    } else {
      for (let index = second; index < vertexCount; index += 1) {
        indexes.push(index);
      }
      for (let index = 0; index <= first; index += 1) {
        indexes.push(index);
      }
    }
    return indexes;
  };

  let repairCount = 0;
  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
    const room = rooms[roomIndex];
    const polygon = room.polygon;
    const vertexCount = polygon.length / 2;
    if (vertexCount < 8) {
      continue;
    }
    const oldArea = signedPolygonArea(polygon);
    if (!(oldArea > 0)) {
      continue;
    }

    // Index paired faces touching each polygon vertex. Dense CAD drawings can produce
    // many equivalent wall-pair hypotheses, so collapse nearly coincident face lines
    // and retain the closest/longest representative.
    const supportsByVertex: PairedWallFaceSupport[][] = [];
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const point = vertexAt(polygon, vertexIndex);
      const supports = new Map<string, PairedWallFaceSupport>();
      for (const wall of walls) {
        const faceC = faceForRoom(wall, room);
        const faceDistance = Math.abs(point.x * wall.normX + point.y * wall.normY - faceC);
        if (faceDistance > faceTolerance) {
          continue;
        }
        const endpointT = projectOnWall(wall, point.x, point.y);
        if (endpointT < -spanExtension || endpointT > wall.length + spanExtension) {
          continue;
        }
        const key = `${Math.round(wall.angle / supportAngleStep)}:${Math.round(faceC / supportOffsetStep)}`;
        const candidate = { wall, faceC, faceDistance, endpointT };
        const current = supports.get(key);
        if (
          !current ||
          faceDistance < current.faceDistance - epsilon ||
          (Math.abs(faceDistance - current.faceDistance) <= epsilon && wall.length > current.wall.length)
        ) {
          supports.set(key, candidate);
        }
      }
      supportsByVertex.push(
        [...supports.values()]
          .sort((a, b) => a.faceDistance - b.faceDistance || b.wall.length - a.wall.length)
          .slice(0, 24)
      );
    }

    const keptEdgeSupportCache = new Map<string, boolean>();
    const keptEdgeHasPairedSupport = (endpointIndex: number, neighborIndex: number): boolean => {
      const key = `${endpointIndex}:${neighborIndex}`;
      const cached = keptEdgeSupportCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const endpoint = vertexAt(polygon, endpointIndex);
      const neighbor = vertexAt(polygon, neighborIndex);
      const dx = neighbor.x - endpoint.x;
      const dy = neighbor.y - endpoint.y;
      const length = Math.hypot(dx, dy);
      if (length < minKeptAnchorLength + keptSpanExtension) {
        keptEdgeSupportCache.set(key, false);
        return false;
      }
      const dirX = dx / length;
      const dirY = dy / length;
      // Allow the polygon junction to sit just beyond the paired run, but require a
      // full anchor-length of supported edge after crossing that small endpoint gap.
      const probeDistance = minKeptAnchorLength + keptSpanExtension;
      const probeX = endpoint.x + dirX * probeDistance;
      const probeY = endpoint.y + dirY * probeDistance;
      for (const wall of walls) {
        if (Math.abs(dirX * wall.dirX + dirY * wall.dirY) < alignedDotMin) {
          continue;
        }
        const faceC = faceForRoom(wall, room);
        if (
          Math.abs(endpoint.x * wall.normX + endpoint.y * wall.normY - faceC) > faceTolerance ||
          Math.abs(probeX * wall.normX + probeY * wall.normY - faceC) > faceTolerance
        ) {
          continue;
        }
        const endpointT = projectOnWall(wall, endpoint.x, endpoint.y);
        const probeT = projectOnWall(wall, probeX, probeY);
        if (
          endpointT >= -keptSpanExtension &&
          endpointT <= wall.length + keptSpanExtension &&
          probeT >= 0 &&
          probeT <= wall.length
        ) {
          keptEdgeSupportCache.set(key, true);
          return true;
        }
      }
      keptEdgeSupportCache.set(key, false);
      return false;
    };

    const chamferSupportCache = new Map<string, boolean>();
    const removedPathHasPairedFaceSupport = (path: number[], cacheKey: string): boolean => {
      const cached = chamferSupportCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
      let totalLength = 0;
      for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
        const previous = vertexAt(polygon, path[pathIndex - 1]);
        const point = vertexAt(polygon, path[pathIndex]);
        totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
      }
      for (const wall of walls) {
        const faceC = faceForRoom(wall, room);
        let supportedLength = 0;
        for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
          const previous = vertexAt(polygon, path[pathIndex - 1]);
          const point = vertexAt(polygon, path[pathIndex]);
          const dx = point.x - previous.x;
          const dy = point.y - previous.y;
          const length = Math.hypot(dx, dy);
          if (!(length > 0) || Math.abs((dx * wall.dirX + dy * wall.dirY) / length) < alignedDotMin) {
            continue;
          }
          if (
            Math.abs(previous.x * wall.normX + previous.y * wall.normY - faceC) > faceTolerance ||
            Math.abs(point.x * wall.normX + point.y * wall.normY - faceC) > faceTolerance
          ) {
            continue;
          }
          const previousT = projectOnWall(wall, previous.x, previous.y);
          const pointT = projectOnWall(wall, point.x, point.y);
          if (
            Math.max(previousT, pointT) >= -spanExtension &&
            Math.min(previousT, pointT) <= wall.length + spanExtension
          ) {
            supportedLength += length;
          }
        }
        if (supportedLength >= 0.65 * totalLength) {
          chamferSupportCache.set(cacheKey, true);
          return true;
        }
      }
      chamferSupportCache.set(cacheKey, false);
      return false;
    };

    let best: {
      polygon: Float64Array;
      area: number;
      removedVertices: number;
      faceError: number;
      excursion: number;
    } | null = null;
    for (let first = 0; first < vertexCount; first += 1) {
      const firstPoint = vertexAt(polygon, first);
      const firstSupports = supportsByVertex[first];
      if (firstSupports.length === 0) {
        continue;
      }
      for (let second = first + 1; second < vertexCount; second += 1) {
        const secondPoint = vertexAt(polygon, second);
        const secondSupports = supportsByVertex[second];
        if (secondSupports.length === 0) {
          continue;
        }
        const endpointDx = secondPoint.x - firstPoint.x;
        const endpointDy = secondPoint.y - firstPoint.y;
        if (
          endpointDx * endpointDx + endpointDy * endpointDy >
          maxEndpointDistanceSquared
        ) {
          continue;
        }
        for (const removeForward of [true, false]) {
          const removedPathCount = removeForward
            ? second - first + 1
            : vertexCount - (second - first) + 1;
          // Inserting the corner adds one vertex, so this also guarantees at least four
          // net vertices are removed from a genuinely complex equipment chain.
          if (removedPathCount < 7) {
            continue;
          }
          const keptFirstNeighbor = removeForward ? (first - 1 + vertexCount) % vertexCount : first + 1;
          const keptSecondNeighbor = removeForward ? (second + 1) % vertexCount : second - 1;
          if (
            !keptEdgeHasPairedSupport(first, keptFirstNeighbor) ||
            !keptEdgeHasPairedSupport(second, keptSecondNeighbor)
          ) {
            continue;
          }
          const pathKey = `${first}:${second}:${removeForward ? 1 : 0}`;
          let removedPath: number[] | null = null;

          for (const firstSupport of firstSupports) {
            for (const secondSupport of secondSupports) {
              const firstWall = firstSupport.wall;
              const secondWall = secondSupport.wall;
              if (
                firstWall.index === secondWall.index ||
                Math.abs(firstWall.dirX * secondWall.dirX + firstWall.dirY * secondWall.dirY) > perpendicularDotMax ||
                firstWall.halfWidth > 2.25 * secondWall.halfWidth ||
                secondWall.halfWidth > 2.25 * firstWall.halfWidth
              ) {
                continue;
              }

              const denominator = cross(firstWall.dirX, firstWall.dirY, secondWall.dirX, secondWall.dirY);
              if (Math.abs(denominator) <= epsilon) {
                continue;
              }
              const firstT =
                cross(
                  secondPoint.x - firstPoint.x,
                  secondPoint.y - firstPoint.y,
                  secondWall.dirX,
                  secondWall.dirY
                ) / denominator;
              // Intersect axis-parallel lines through the retained endpoints. Paired
              // faces still validate both legs, but the output itself is exactly
              // aligned with the existing wall edges instead of inheriting a small
              // face-offset mismatch as a visibly slanted segment.
              const cornerX = firstPoint.x + firstWall.dirX * firstT;
              const cornerY = firstPoint.y + firstWall.dirY * firstT;
              const firstCornerT = projectOnWall(firstWall, cornerX, cornerY);
              const secondCornerT = projectOnWall(secondWall, cornerX, cornerY);
              if (
                firstCornerT < -spanExtension ||
                firstCornerT > firstWall.length + spanExtension ||
                secondCornerT < -spanExtension ||
                secondCornerT > secondWall.length + spanExtension ||
                !spanCoversLeg(firstWall, firstSupport.endpointT, firstCornerT) ||
                !spanCoversLeg(secondWall, secondSupport.endpointT, secondCornerT)
              ) {
                continue;
              }

              const firstLegLength = Math.hypot(firstPoint.x - cornerX, firstPoint.y - cornerY);
              const secondLegLength = Math.hypot(secondPoint.x - cornerX, secondPoint.y - cornerY);
              if (
                firstLegLength < minLegLength ||
                firstLegLength > maxLegLength ||
                secondLegLength < minLegLength ||
                secondLegLength > maxLegLength ||
                firstLegLength + secondLegLength > maxTotalLegLength
              ) {
                continue;
              }

              removedPath ??= pathIndexes(vertexCount, first, second, removeForward);
              if (removedPathHasPairedFaceSupport(removedPath, pathKey)) {
                continue;
              }

              let maxExcursion = 0;
              for (const pathIndex of removedPath) {
                const point = vertexAt(polygon, pathIndex);
                maxExcursion = Math.max(
                  maxExcursion,
                  Math.sqrt(
                    Math.min(
                      distanceToSegmentSquared(point.x, point.y, firstPoint.x, firstPoint.y, cornerX, cornerY),
                      distanceToSegmentSquared(point.x, point.y, cornerX, cornerY, secondPoint.x, secondPoint.y)
                    )
                  )
                );
              }
              if (maxExcursion < minDetourExcursion) {
                continue;
              }

              const replacement = replacementPolygon(
                polygon,
                first,
                second,
                removeForward,
                cornerX,
                cornerY
              );
              const removedVertices = vertexCount - replacement.length / 2;
              const replacementArea = signedPolygonArea(replacement);
              const addedArea = replacementArea - oldArea;
              if (
                removedVertices < 4 ||
                addedArea < minAddedArea ||
                addedArea > Math.min(0.12 * oldArea, maxAddedArea) ||
                !isSimplePolygon(replacement, epsilon) ||
                !pointInPolygon(room.labelX, room.labelY, replacement) ||
                !room.labels.every((label) =>
                  pointInPolygon((label.minX + label.maxX) / 2, (label.minY + label.maxY) / 2, replacement)
                )
              ) {
                continue;
              }

              let capturesOtherAnchor = false;
              for (let otherIndex = 0; otherIndex < rooms.length; otherIndex += 1) {
                if (otherIndex === roomIndex) {
                  continue;
                }
                const other = rooms[otherIndex];
                if (
                  !pointInPolygon(other.labelX, other.labelY, polygon) &&
                  pointInPolygon(other.labelX, other.labelY, replacement)
                ) {
                  capturesOtherAnchor = true;
                  break;
                }
              }
              if (capturesOtherAnchor) {
                continue;
              }

              const replacementBounds = polygonBounds(replacement);
              let overlapsAnotherRoom = false;
              for (let otherIndex = 0; otherIndex < rooms.length; otherIndex += 1) {
                if (otherIndex === roomIndex) {
                  continue;
                }
                const other = rooms[otherIndex];
                const otherBounds = polygonBounds(other.polygon);
                if (
                  boundsHaveInteriorIntersection(replacementBounds, otherBounds, epsilon) &&
                  polygonsHavePositiveAreaOverlap(replacement, other.polygon, replacementBounds, otherBounds, epsilon)
                ) {
                  overlapsAnotherRoom = true;
                  break;
                }
              }
              if (overlapsAnotherRoom) {
                continue;
              }

              const faceError = firstSupport.faceDistance + secondSupport.faceDistance;
              if (
                !best ||
                removedVertices > best.removedVertices ||
                (removedVertices === best.removedVertices && faceError < best.faceError - epsilon) ||
                (removedVertices === best.removedVertices &&
                  Math.abs(faceError - best.faceError) <= epsilon &&
                  maxExcursion > best.excursion)
              ) {
                best = {
                  polygon: replacement,
                  area: replacementArea,
                  removedVertices,
                  faceError,
                  excursion: maxExcursion
                };
              }
            }
          }
        }
      }
    }

    if (best) {
      room.polygon = new Float32Array(best.polygon);
      room.area = best.area;
      repairCount += 1;
    }
  }
  return repairCount;
}

interface PairedStructuralCapHypothesis {
  wall: PairedWallGeometry;
  firstCornerX: number;
  firstCornerY: number;
  secondCornerX: number;
  secondCornerY: number;
  firstLegLength: number;
  secondLegLength: number;
  sideSign: number;
  span: number;
}

/**
 * Replace one decisive equipment-created detour by a U-shaped structural cap. The
 * output side legs pass through retained contour contacts (so they cannot inherit a
 * small paired-face offset mismatch), while the cap itself lies on the nearest
 * room-facing face of a long paired wall.
 */
function repairPairedWallStructuralCaps(
  rooms: DetectedRoom[],
  pairedWalls: number[],
  doorGapMax: number
): number {
  const pairedWallCount = pairedWalls.length / WALL_STRIDE;
  if (rooms.length === 0 || pairedWallCount < 3 || !(doorGapMax > 0)) {
    return 0;
  }

  const epsilon = 1e-9;
  const faceTolerance = 0.15 * doorGapMax;
  const spanExtension = 0.15 * doorGapMax;
  const minSideRun = 3 * doorGapMax;
  const minCapRun = 4 * doorGapMax;
  const minCapSpan = 2 * doorGapMax;
  const maxCapSpan = 6 * doorGapMax;
  const minSideLeg = 0.25 * doorGapMax;
  const maxSideLeg = 1.75 * doorGapMax;
  const minKeptSideSupport = 0.4 * doorGapMax;
  const maxKeptSideProbe = 2 * doorGapMax;
  const minExcursion = 0.25 * doorGapMax;
  const minAddedArea = 0.25 * doorGapMax * doorGapMax;
  const maxAddedArea = 2.25 * doorGapMax * doorGapMax;
  const alignedDotMin = Math.cos((10 * Math.PI) / 180);
  const perpendicularDotMax = Math.sin((10 * Math.PI) / 180);
  const angleKeyStep = (5 * Math.PI) / 180;
  const faceKeyStep = 0.06 * doorGapMax;
  const nearerCapMargin = 0.02 * doorGapMax;

  const allWalls: PairedWallGeometry[] = [];
  for (let wallIndex = 0; wallIndex < pairedWallCount; wallIndex += 1) {
    const base = wallIndex * WALL_STRIDE;
    let x0 = pairedWalls[base];
    let y0 = pairedWalls[base + 1];
    let x1 = pairedWalls[base + 2];
    let y1 = pairedWalls[base + 3];
    const halfWidth = pairedWalls[base + 4];
    let dx = x1 - x0;
    let dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (!(length > 0) || !(halfWidth > 0) || halfWidth > 0.35 * doorGapMax) {
      continue;
    }
    if (dx < -epsilon || (Math.abs(dx) <= epsilon && dy < 0)) {
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
      dx = -dx;
      dy = -dy;
    }
    const dirX = dx / length;
    const dirY = dy / length;
    const normX = -dirY;
    const normY = dirX;
    let angle = Math.atan2(dirY, dirX);
    if (angle < 0) {
      angle += Math.PI;
    }
    allWalls.push({
      index: wallIndex,
      x0,
      y0,
      dirX,
      dirY,
      normX,
      normY,
      centerC: x0 * normX + y0 * normY,
      length,
      halfWidth,
      angle
    });
  }
  const sideWalls = allWalls.filter((wall) => wall.length + epsilon >= minSideRun);
  const barrierWalls = allWalls.filter((wall) => wall.length + epsilon >= minCapSpan);
  const capWalls = barrierWalls.filter((wall) => wall.length + epsilon >= minCapRun);
  if (sideWalls.length < 2 || capWalls.length === 0) {
    return 0;
  }

  const vertexAt = (polygon: ArrayLike<number>, index: number): { x: number; y: number } => ({
    x: polygon[index * 2],
    y: polygon[index * 2 + 1]
  });
  const faceForRoom = (wall: PairedWallGeometry, room: DetectedRoom): number => {
    const anchorC = room.labelX * wall.normX + room.labelY * wall.normY;
    return wall.centerC + (anchorC >= wall.centerC ? 1 : -1) * wall.halfWidth;
  };
  const projectOnWall = (wall: PairedWallGeometry, x: number, y: number): number =>
    (x - wall.x0) * wall.dirX + (y - wall.y0) * wall.dirY;
  const spanContains = (wall: PairedWallGeometry, firstT: number, secondT: number): boolean =>
    Math.min(firstT, secondT) >= -spanExtension &&
    Math.max(firstT, secondT) <= wall.length + spanExtension;
  const widthsAgree = (first: PairedWallGeometry, second: PairedWallGeometry): boolean =>
    first.halfWidth <= 2.25 * second.halfWidth && second.halfWidth <= 2.25 * first.halfWidth;
  const pathIndexes = (vertexCount: number, first: number, second: number, forward: boolean): number[] => {
    const indexes: number[] = [];
    if (forward) {
      for (let index = first; index <= second; index += 1) {
        indexes.push(index);
      }
    } else {
      for (let index = second; index < vertexCount; index += 1) {
        indexes.push(index);
      }
      for (let index = 0; index <= first; index += 1) {
        indexes.push(index);
      }
    }
    return indexes;
  };
  const replacementPolygon = (
    polygon: ArrayLike<number>,
    first: number,
    second: number,
    removeForward: boolean,
    cap: PairedStructuralCapHypothesis
  ): Float64Array => {
    const vertexCount = polygon.length / 2;
    const values: number[] = [];
    if (removeForward) {
      for (let index = 0; index <= first; index += 1) {
        values.push(polygon[index * 2], polygon[index * 2 + 1]);
      }
      values.push(
        cap.firstCornerX,
        cap.firstCornerY,
        cap.secondCornerX,
        cap.secondCornerY
      );
      for (let index = second; index < vertexCount; index += 1) {
        values.push(polygon[index * 2], polygon[index * 2 + 1]);
      }
    } else {
      for (let index = first; index <= second; index += 1) {
        values.push(polygon[index * 2], polygon[index * 2 + 1]);
      }
      values.push(
        cap.secondCornerX,
        cap.secondCornerY,
        cap.firstCornerX,
        cap.firstCornerY
      );
    }
    return new Float64Array(values);
  };

  let repairCount = 0;
  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
    const room = rooms[roomIndex];
    const polygon = room.polygon;
    const vertexCount = polygon.length / 2;
    if (vertexCount < 10) {
      continue;
    }
    const oldArea = signedPolygonArea(polygon);
    if (!(oldArea > 0)) {
      continue;
    }
    const supportsByVertex: PairedWallFaceSupport[][] = [];
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const point = vertexAt(polygon, vertexIndex);
      const supports = new Map<string, PairedWallFaceSupport>();
      for (const wall of sideWalls) {
        const faceC = faceForRoom(wall, room);
        const faceDistance = Math.abs(point.x * wall.normX + point.y * wall.normY - faceC);
        if (faceDistance > faceTolerance) {
          continue;
        }
        const endpointT = projectOnWall(wall, point.x, point.y);
        if (endpointT < -spanExtension || endpointT > wall.length + spanExtension) {
          continue;
        }
        const key = `${Math.round(wall.angle / angleKeyStep)}:${Math.round(faceC / faceKeyStep)}`;
        const candidate = { wall, faceC, faceDistance, endpointT };
        const current = supports.get(key);
        if (
          !current ||
          faceDistance < current.faceDistance - epsilon ||
          (Math.abs(faceDistance - current.faceDistance) <= epsilon && wall.length > current.wall.length)
        ) {
          supports.set(key, candidate);
        }
      }
      supportsByVertex.push(
        [...supports.values()]
          .sort((first, second) =>
            first.faceDistance - second.faceDistance || second.wall.length - first.wall.length
          )
          .slice(0, 16)
      );
    }

    const keptSupportCache = new Map<string, boolean>();
    const hasRetainedSideSupport = (
      endpointIndex: number,
      step: -1 | 1,
      support: PairedWallFaceSupport
    ): boolean => {
      const key = `${endpointIndex}:${step}:${support.wall.index}`;
      const cached = keptSupportCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const wall = support.wall;
      const faceC = support.faceC;
      let index = endpointIndex;
      let traversed = 0;
      let supported = 0;
      let unsupported = 0;
      for (let edgeCount = 0; edgeCount < 8 && traversed < maxKeptSideProbe; edgeCount += 1) {
        const nextIndex = (index + step + vertexCount) % vertexCount;
        const point = vertexAt(polygon, index);
        const next = vertexAt(polygon, nextIndex);
        const dx = next.x - point.x;
        const dy = next.y - point.y;
        const length = Math.hypot(dx, dy);
        if (!(length > 0)) {
          index = nextIndex;
          continue;
        }
        traversed += length;
        const aligned = Math.abs((dx * wall.dirX + dy * wall.dirY) / length) >= alignedDotMin;
        const onFace =
          Math.abs(point.x * wall.normX + point.y * wall.normY - faceC) <= faceTolerance &&
          Math.abs(next.x * wall.normX + next.y * wall.normY - faceC) <= faceTolerance;
        const pointT = projectOnWall(wall, point.x, point.y);
        const nextT = projectOnWall(wall, next.x, next.y);
        if (
          aligned &&
          onFace &&
          Math.min(pointT, nextT) <= wall.length + spanExtension &&
          Math.max(pointT, nextT) >= -spanExtension
        ) {
          // A retained contour edge can legitimately continue beyond the paired run.
          // Count only its continuously overlapping portion instead of rejecting the
          // entire edge because its remote endpoint lies past the structural track.
          supported += Math.max(
            0,
            Math.min(Math.max(pointT, nextT), wall.length) - Math.max(Math.min(pointT, nextT), 0)
          );
          if (supported >= minKeptSideSupport) {
            keptSupportCache.set(key, true);
            return true;
          }
        } else {
          unsupported += length;
          if (unsupported > 0.15 * doorGapMax) {
            break;
          }
        }
        index = nextIndex;
      }
      keptSupportCache.set(key, false);
      return false;
    };

    const pairedPathSupportCache = new Map<string, boolean>();
    const pathHasSinglePairedSupport = (path: number[], key: string): boolean => {
      const cached = pairedPathSupportCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      let totalLength = 0;
      for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
        const previous = vertexAt(polygon, path[pathIndex - 1]);
        const point = vertexAt(polygon, path[pathIndex]);
        totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
      }
      if (!(totalLength > epsilon)) {
        pairedPathSupportCache.set(key, false);
        return false;
      }
      for (const wall of allWalls) {
        if (wall.length < 0.5 * totalLength) {
          continue;
        }
        const faceC = faceForRoom(wall, room);
        let supportedLength = 0;
        for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
          const previous = vertexAt(polygon, path[pathIndex - 1]);
          const point = vertexAt(polygon, path[pathIndex]);
          const dx = point.x - previous.x;
          const dy = point.y - previous.y;
          const length = Math.hypot(dx, dy);
          if (!(length > 0) || Math.abs((dx * wall.dirX + dy * wall.dirY) / length) < alignedDotMin) {
            continue;
          }
          if (
            Math.abs(previous.x * wall.normX + previous.y * wall.normY - faceC) > faceTolerance ||
            Math.abs(point.x * wall.normX + point.y * wall.normY - faceC) > faceTolerance
          ) {
            continue;
          }
          const previousT = projectOnWall(wall, previous.x, previous.y);
          const pointT = projectOnWall(wall, point.x, point.y);
          if (spanContains(wall, previousT, pointT)) {
            supportedLength += length;
          }
        }
        if (supportedLength >= 0.6 * totalLength) {
          pairedPathSupportCache.set(key, true);
          return true;
        }
      }
      pairedPathSupportCache.set(key, false);
      return false;
    };

    let best: {
      polygon: Float64Array;
      area: number;
      addedArea: number;
      removedVertices: number;
      faceError: number;
    } | null = null;
    for (let first = 0; first < vertexCount; first += 1) {
      const firstSupports = supportsByVertex[first];
      if (firstSupports.length === 0) {
        continue;
      }
      const firstPoint = vertexAt(polygon, first);
      for (let second = first + 1; second < vertexCount; second += 1) {
        const secondSupports = supportsByVertex[second];
        if (secondSupports.length === 0) {
          continue;
        }
        const secondPoint = vertexAt(polygon, second);
        const endpointDistance = Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);
        if (endpointDistance < minCapSpan - 2 * faceTolerance || endpointDistance > maxCapSpan + 2 * maxSideLeg) {
          continue;
        }
        for (const removeForward of [true, false]) {
          const removedPathCount = removeForward
            ? second - first + 1
            : vertexCount - (second - first) + 1;
          if (removedPathCount < 8) {
            continue;
          }
          const retainedFirstStep: -1 | 1 = removeForward ? -1 : 1;
          const retainedSecondStep: -1 | 1 = removeForward ? 1 : -1;
          const removedPath = pathIndexes(vertexCount, first, second, removeForward);
          const pathKey = `${first}:${second}:${removeForward ? 1 : 0}`;
          let removedPathLength = -1;

          for (const firstSupport of firstSupports) {
            const firstRetained = hasRetainedSideSupport(first, retainedFirstStep, firstSupport);
            if (!firstRetained) {
              continue;
            }
            for (const secondSupport of secondSupports) {
              const secondRetained = hasRetainedSideSupport(second, retainedSecondStep, secondSupport);
              if (!secondRetained) {
                continue;
              }
              const firstWall = firstSupport.wall;
              const secondWall = secondSupport.wall;
              if (
                firstWall.index === secondWall.index ||
                Math.abs(firstWall.dirX * secondWall.dirX + firstWall.dirY * secondWall.dirY) < alignedDotMin ||
                !widthsAgree(firstWall, secondWall)
              ) {
                continue;
              }

              const caps: PairedStructuralCapHypothesis[] = [];
              const barriers: PairedStructuralCapHypothesis[] = [];
              for (const capWall of barrierWalls) {
                if (
                  capWall.index === firstWall.index ||
                  capWall.index === secondWall.index ||
                  Math.abs(firstWall.dirX * capWall.dirX + firstWall.dirY * capWall.dirY) >
                    perpendicularDotMax ||
                  Math.abs(secondWall.dirX * capWall.dirX + secondWall.dirY * capWall.dirY) >
                    perpendicularDotMax ||
                  !widthsAgree(firstWall, capWall) ||
                  !widthsAgree(secondWall, capWall)
                ) {
                  continue;
                }
                const capFaceC = faceForRoom(capWall, room);
                const firstDenominator = firstWall.dirX * capWall.normX + firstWall.dirY * capWall.normY;
                const secondDenominator = secondWall.dirX * capWall.normX + secondWall.dirY * capWall.normY;
                if (Math.abs(firstDenominator) < alignedDotMin || Math.abs(secondDenominator) < alignedDotMin) {
                  continue;
                }
                const firstSignedLeg =
                  (capFaceC - firstPoint.x * capWall.normX - firstPoint.y * capWall.normY) /
                  firstDenominator;
                const secondSignedLeg =
                  (capFaceC - secondPoint.x * capWall.normX - secondPoint.y * capWall.normY) /
                  secondDenominator;
                if (firstSignedLeg * secondSignedLeg <= 0) {
                  continue;
                }
                const firstLegLength = Math.abs(firstSignedLeg);
                const secondLegLength = Math.abs(secondSignedLeg);
                if (firstLegLength > maxSideLeg || secondLegLength > maxSideLeg) {
                  continue;
                }
                const firstCornerX = firstPoint.x + firstWall.dirX * firstSignedLeg;
                const firstCornerY = firstPoint.y + firstWall.dirY * firstSignedLeg;
                const secondCornerX = secondPoint.x + secondWall.dirX * secondSignedLeg;
                const secondCornerY = secondPoint.y + secondWall.dirY * secondSignedLeg;
                const capFirstT = projectOnWall(capWall, firstCornerX, firstCornerY);
                const capSecondT = projectOnWall(capWall, secondCornerX, secondCornerY);
                const selectableSpan = spanContains(capWall, capFirstT, capSecondT);
                const minCapT = Math.min(capFirstT, capSecondT);
                const maxCapT = Math.max(capFirstT, capSecondT);
                const barrierOverlap = Math.max(
                  0,
                  Math.min(maxCapT, capWall.length) - Math.max(minCapT, 0)
                );
                const barrierEndpointGap = Math.max(0, -minCapT, maxCapT - capWall.length);
                // A shorter paired core can still be a genuine intervening barrier
                // when ordinary wall continuation closes modest gaps to both side
                // tracks. Such a core blocks a remote repair but is never selectable
                // as the replacement cap itself.
                const blockingSpan =
                  barrierOverlap + epsilon >= minCapSpan &&
                  barrierEndpointGap <= doorGapMax;
                if (!selectableSpan && !blockingSpan) {
                  continue;
                }
                const span = Math.hypot(secondCornerX - firstCornerX, secondCornerY - firstCornerY);
                if (span < minCapSpan || span > maxCapSpan) {
                  continue;
                }
                const firstEndpointT = projectOnWall(firstWall, firstPoint.x, firstPoint.y);
                const firstCornerT = projectOnWall(firstWall, firstCornerX, firstCornerY);
                const secondEndpointT = projectOnWall(secondWall, secondPoint.x, secondPoint.y);
                const secondCornerT = projectOnWall(secondWall, secondCornerX, secondCornerY);
                if (
                  !spanContains(firstWall, firstEndpointT, firstCornerT) ||
                  !spanContains(secondWall, secondEndpointT, secondCornerT)
                ) {
                  continue;
                }
                const capAnchorT = projectOnWall(capWall, room.labelX, room.labelY);
                if (
                  capAnchorT <= Math.min(capFirstT, capSecondT) + 0.05 * doorGapMax ||
                  capAnchorT >= Math.max(capFirstT, capSecondT) - 0.05 * doorGapMax
                ) {
                  continue;
                }
                const hypothesis = {
                  wall: capWall,
                  firstCornerX,
                  firstCornerY,
                  secondCornerX,
                  secondCornerY,
                  firstLegLength,
                  secondLegLength,
                  sideSign: Math.sign(firstSignedLeg),
                  span
                };
                barriers.push(hypothesis);
                if (selectableSpan && capWall.length + epsilon >= minCapRun) {
                  caps.push(hypothesis);
                }
              }

              for (const cap of caps) {
                if (cap.firstLegLength < minSideLeg || cap.secondLegLength < minSideLeg) {
                  continue;
                }
                // A farther wall cannot be used to jump across a nearer continuous
                // paired cap, even when the nearer cap would add too little area to
                // justify any cleanup by itself.
                if (
                  barriers.some(
                    (other) =>
                      other !== cap &&
                      other.sideSign === cap.sideSign &&
                      other.firstLegLength + nearerCapMargin < cap.firstLegLength &&
                      other.secondLegLength + nearerCapMargin < cap.secondLegLength
                  )
                ) {
                  continue;
                }
                // Paired-path inspection is deliberately lazy: most endpoint pairs
                // never produce a valid three-track cap, especially on dense CAD
                // pages with thousands of paired furniture hypotheses.
                if (pathHasSinglePairedSupport(removedPath, pathKey)) {
                  continue;
                }
                if (removedPathLength < 0) {
                  removedPathLength = 0;
                  for (let pathIndex = 1; pathIndex < removedPath.length; pathIndex += 1) {
                    const previous = vertexAt(polygon, removedPath[pathIndex - 1]);
                    const point = vertexAt(polygon, removedPath[pathIndex]);
                    removedPathLength += Math.hypot(point.x - previous.x, point.y - previous.y);
                  }
                }
                const replacementLength = cap.firstLegLength + cap.span + cap.secondLegLength;
                if (removedPathLength < 1.15 * replacementLength) {
                  continue;
                }
                let maxExcursion = 0;
                for (const pathIndex of removedPath) {
                  const point = vertexAt(polygon, pathIndex);
                  maxExcursion = Math.max(
                    maxExcursion,
                    Math.sqrt(
                      Math.min(
                        distanceToSegmentSquared(
                          point.x,
                          point.y,
                          firstPoint.x,
                          firstPoint.y,
                          cap.firstCornerX,
                          cap.firstCornerY
                        ),
                        distanceToSegmentSquared(
                          point.x,
                          point.y,
                          cap.firstCornerX,
                          cap.firstCornerY,
                          cap.secondCornerX,
                          cap.secondCornerY
                        ),
                        distanceToSegmentSquared(
                          point.x,
                          point.y,
                          cap.secondCornerX,
                          cap.secondCornerY,
                          secondPoint.x,
                          secondPoint.y
                        )
                      )
                    )
                  );
                }
                if (maxExcursion < minExcursion) {
                  continue;
                }

                const replacement = replacementPolygon(polygon, first, second, removeForward, cap);
                const removedVertices = vertexCount - replacement.length / 2;
                const replacementArea = signedPolygonArea(replacement);
                const addedArea = replacementArea - oldArea;
                if (
                  removedVertices < 4 ||
                  addedArea < minAddedArea ||
                  addedArea > Math.min(0.2 * oldArea, maxAddedArea) ||
                  !isSimplePolygon(replacement, epsilon) ||
                  !pointInPolygon(room.labelX, room.labelY, replacement) ||
                  !room.labels.every((label) =>
                    pointInPolygon((label.minX + label.maxX) / 2, (label.minY + label.maxY) / 2, replacement)
                  )
                ) {
                  continue;
                }

                let capturesOtherAnchor = false;
                for (let otherIndex = 0; otherIndex < rooms.length; otherIndex += 1) {
                  if (otherIndex === roomIndex) {
                    continue;
                  }
                  const other = rooms[otherIndex];
                  if (
                    !pointInPolygon(other.labelX, other.labelY, polygon) &&
                    pointInPolygon(other.labelX, other.labelY, replacement)
                  ) {
                    capturesOtherAnchor = true;
                    break;
                  }
                }
                if (capturesOtherAnchor) {
                  continue;
                }

                const replacementBounds = polygonBounds(replacement);
                let overlapsAnotherRoom = false;
                for (let otherIndex = 0; otherIndex < rooms.length; otherIndex += 1) {
                  if (otherIndex === roomIndex) {
                    continue;
                  }
                  const other = rooms[otherIndex];
                  const otherBounds = polygonBounds(other.polygon);
                  if (
                    boundsHaveInteriorIntersection(replacementBounds, otherBounds, epsilon) &&
                    polygonsHavePositiveAreaOverlap(replacement, other.polygon, replacementBounds, otherBounds, epsilon)
                  ) {
                    overlapsAnotherRoom = true;
                    break;
                  }
                }
                if (overlapsAnotherRoom) {
                  continue;
                }

                const faceError = firstSupport.faceDistance + secondSupport.faceDistance;
                // First remove the most complete unsupported detour. When candidates
                // remove the same number of contour vertices, prefer the smallest
                // topology-safe positive fill among the near-coincident cap faces.
                if (
                  !best ||
                  removedVertices > best.removedVertices ||
                  (removedVertices === best.removedVertices && addedArea < best.addedArea - epsilon) ||
                  (removedVertices === best.removedVertices &&
                    Math.abs(addedArea - best.addedArea) <= epsilon &&
                    faceError < best.faceError)
                ) {
                  best = { polygon: replacement, area: replacementArea, addedArea, removedVertices, faceError };
                }
              }
            }
          }
        }
      }
    }

    if (best) {
      room.polygon = new Float32Array(best.polygon);
      room.area = best.area;
      repairCount += 1;
    }
  }
  return repairCount;
}

interface RectangularEnvelopeContourLine {
  dirX: number;
  dirY: number;
  normX: number;
  normY: number;
  faceC: number;
  edgeLength: number;
  intervals: { start: number; end: number }[];
}

interface RectangularEnvelopeWallCandidate {
  wall: PairedWallGeometry;
  faceC: number;
  minT: number;
  maxT: number;
  overlap: number;
}

interface RectangularEnvelopeSideSupport {
  faceC: number;
  coverage: number;
  longestRun: number;
  halfWidth: number;
  full: boolean;
  hybrid: boolean;
  overrunsStart: boolean;
  overrunsEnd: boolean;
  overrunsBoth: boolean;
}

/**
 * Restore one complete room side that an attached equipment outline displaced inward.
 * This is intentionally stricter than a generic bounding-box snap: the current contour
 * must already trace three sides of one orthogonal structural envelope, while the only
 * missing side is the nearest long paired face just outside the room. A sparse wall grid
 * keeps candidate discovery local even on CAD pages with thousands of paired tracks.
 */
function repairPairedWallRectangularEnvelope(
  rooms: DetectedRoom[],
  pairedWalls: number[],
  doorGapMax: number
): number {
  const pairedWallCount = pairedWalls.length / WALL_STRIDE;
  if (rooms.length === 0 || pairedWallCount < 3 || !(doorGapMax > 0)) {
    return 0;
  }

  const epsilon = 1e-9;
  const alignedDotMin = Math.cos((8 * Math.PI) / 180);
  const contourAlignedDotMin = Math.cos((10 * Math.PI) / 180);
  const perpendicularDotMax = Math.sin((8 * Math.PI) / 180);
  const contourFaceTolerance = 0.12 * doorGapMax;
  const structuralFaceTolerance = 0.12 * doorGapMax;
  const minIndexedRun = 0.35 * doorGapMax;
  const minLongRun = 3 * doorGapMax;
  const maxHalfWidth = 0.2 * doorGapMax;
  const minMissingOffset = 0.25 * doorGapMax;
  const maxMissingOffset = 0.9 * doorGapMax;
  const minMissingContourSpan = 1.5 * doorGapMax;
  const minOppositeContourSpan = 1.15 * doorGapMax;
  const minEnvelopeSide = 2 * doorGapMax;
  const maxEnvelopeSide = 10 * doorGapMax;
  const minEnvelopeArea = 8 * doorGapMax * doorGapMax;
  const minAddedArea = 0.5 * doorGapMax * doorGapMax;
  const maxAddedArea = 2.25 * doorGapMax * doorGapMax;
  const expandedEnvelopeTolerance = 0.2 * doorGapMax;

  const indexedWalls: PairedWallGeometry[] = [];
  const indexedValues: number[] = [];
  let wallMinX = Infinity;
  let wallMinY = Infinity;
  let wallMaxX = -Infinity;
  let wallMaxY = -Infinity;
  for (let wallIndex = 0; wallIndex < pairedWallCount; wallIndex += 1) {
    const base = wallIndex * WALL_STRIDE;
    let x0 = pairedWalls[base];
    let y0 = pairedWalls[base + 1];
    let x1 = pairedWalls[base + 2];
    let y1 = pairedWalls[base + 3];
    const halfWidth = pairedWalls[base + 4];
    let dx = x1 - x0;
    let dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < minIndexedRun || !(halfWidth > 0) || halfWidth > maxHalfWidth) {
      continue;
    }
    if (dx < -epsilon || (Math.abs(dx) <= epsilon && dy < 0)) {
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
      dx = -dx;
      dy = -dy;
    }
    const dirX = dx / length;
    const dirY = dy / length;
    const normX = -dirY;
    const normY = dirX;
    let angle = Math.atan2(dirY, dirX);
    if (angle < 0) {
      angle += Math.PI;
    }
    indexedWalls.push({
      index: wallIndex,
      x0,
      y0,
      dirX,
      dirY,
      normX,
      normY,
      centerC: x0 * normX + y0 * normY,
      length,
      halfWidth,
      angle
    });
    indexedValues.push(x0, y0, x1, y1, halfWidth);
    wallMinX = Math.min(wallMinX, x0, x1);
    wallMinY = Math.min(wallMinY, y0, y1);
    wallMaxX = Math.max(wallMaxX, x0, x1);
    wallMaxY = Math.max(wallMaxY, y0, y1);
  }
  if (indexedWalls.length < 3) {
    return 0;
  }
  const wallGrid = new WallGrid(
    new Float64Array(indexedValues),
    indexedWalls.length,
    wallMinX - doorGapMax,
    wallMinY - doorGapMax,
    wallMaxX + doorGapMax,
    wallMaxY + doorGapMax,
    doorGapMax
  );

  const canonicalDirection = (dx: number, dy: number): { x: number; y: number; length: number } | null => {
    const length = Math.hypot(dx, dy);
    if (!(length > epsilon)) {
      return null;
    }
    let x = dx / length;
    let y = dy / length;
    if (x < -epsilon || (Math.abs(x) <= epsilon && y < 0)) {
      x = -x;
      y = -y;
    }
    return { x, y, length };
  };
  const mergeIntervals = (
    intervals: { start: number; end: number }[],
    start: number,
    end: number
  ): { length: number; first: number; last: number; merged: { start: number; end: number }[] } => {
    const clipped = intervals
      .map((interval) => ({ start: Math.max(start, interval.start), end: Math.min(end, interval.end) }))
      .filter((interval) => interval.end > interval.start + epsilon)
      .sort((first, second) => first.start - second.start || first.end - second.end);
    const merged: { start: number; end: number }[] = [];
    for (const interval of clipped) {
      const last = merged[merged.length - 1];
      if (!last || interval.start > last.end + epsilon) {
        merged.push({ ...interval });
      } else {
        last.end = Math.max(last.end, interval.end);
      }
    }
    let length = 0;
    for (const interval of merged) {
      length += interval.end - interval.start;
    }
    return {
      length,
      first: merged[0]?.start ?? Infinity,
      last: merged[merged.length - 1]?.end ?? -Infinity,
      merged
    };
  };
  const intervalLengthWithin = (
    intervals: { start: number; end: number }[],
    start: number,
    end: number
  ): number => mergeIntervals(intervals, start, end).length;
  const faceForRoom = (wall: PairedWallGeometry, room: DetectedRoom): number => {
    const anchorC = room.labelX * wall.normX + room.labelY * wall.normY;
    return wall.centerC + (anchorC >= wall.centerC ? 1 : -1) * wall.halfWidth;
  };
  const wallFaceCoordinate = (
    wall: PairedWallGeometry,
    room: DetectedRoom,
    normX: number,
    normY: number
  ): number => {
    const offset = faceForRoom(wall, room) - wall.centerC;
    return (wall.x0 + wall.normX * offset) * normX + (wall.y0 + wall.normY * offset) * normY;
  };
  const linePoint = (
    dirX: number,
    dirY: number,
    normX: number,
    normY: number,
    faceC: number,
    t: number
  ): { x: number; y: number } => ({
    x: dirX * t + normX * faceC,
    y: dirY * t + normY * faceC
  });

  const collectContourLines = (polygon: ArrayLike<number>): RectangularEnvelopeContourLine[] => {
    const vertexCount = polygon.length / 2;
    const lines: RectangularEnvelopeContourLine[] = [];
    for (let index = 0; index < vertexCount; index += 1) {
      const next = (index + 1) % vertexCount;
      const x0 = polygon[index * 2];
      const y0 = polygon[index * 2 + 1];
      const x1 = polygon[next * 2];
      const y1 = polygon[next * 2 + 1];
      const direction = canonicalDirection(x1 - x0, y1 - y0);
      if (!direction || direction.length < 0.15 * doorGapMax) {
        continue;
      }
      const midpointX = 0.5 * (x0 + x1);
      const midpointY = 0.5 * (y0 + y1);
      // A contour is cyclic and connected, so collinear fragments belonging to one
      // physical side occur locally in traversal order (tiny furniture steps may sit
      // between them). Limit the merge search to a fixed recent window: this keeps
      // contour collection linear while retaining those interrupted straight runs.
      let line: RectangularEnvelopeContourLine | undefined;
      const firstCandidate = Math.max(0, lines.length - 12);
      for (let candidateIndex = lines.length - 1; candidateIndex >= firstCandidate; candidateIndex -= 1) {
        const candidate = lines[candidateIndex];
        if (
          Math.abs(candidate.dirX * direction.x + candidate.dirY * direction.y) >= contourAlignedDotMin &&
          Math.abs(midpointX * candidate.normX + midpointY * candidate.normY - candidate.faceC) <=
            contourFaceTolerance
        ) {
          line = candidate;
          break;
        }
      }
      if (!line) {
        const normX = -direction.y;
        const normY = direction.x;
        line = {
          dirX: direction.x,
          dirY: direction.y,
          normX,
          normY,
          faceC: midpointX * normX + midpointY * normY,
          edgeLength: 0,
          intervals: []
        };
        lines.push(line);
      }
      const firstT = x0 * line.dirX + y0 * line.dirY;
      const secondT = x1 * line.dirX + y1 * line.dirY;
      const previousWeight = line.edgeLength;
      line.edgeLength += direction.length;
      line.faceC =
        (line.faceC * previousWeight +
          (midpointX * line.normX + midpointY * line.normY) * direction.length) /
        line.edgeLength;
      line.intervals.push({ start: Math.min(firstT, secondT), end: Math.max(firstT, secondT) });
    }
    return lines;
  };
  const contourLineRange = (
    line: RectangularEnvelopeContourLine,
    targetDirX: number,
    targetDirY: number
  ): { start: number; end: number } => {
    let start = Infinity;
    let end = -Infinity;
    for (const interval of line.intervals) {
      for (const t of [interval.start, interval.end]) {
        const point = linePoint(line.dirX, line.dirY, line.normX, line.normY, line.faceC, t);
        const projected = point.x * targetDirX + point.y * targetDirY;
        start = Math.min(start, projected);
        end = Math.max(end, projected);
      }
    }
    return { start, end };
  };
  const contourLineCoordinate = (
    line: RectangularEnvelopeContourLine,
    normX: number,
    normY: number
  ): number => {
    const interval = line.intervals[0];
    const t = interval ? 0.5 * (interval.start + interval.end) : 0;
    const point = linePoint(line.dirX, line.dirY, line.normX, line.normY, line.faceC, t);
    return point.x * normX + point.y * normY;
  };
  const queryWallIndexes = (
    dirX: number,
    dirY: number,
    normX: number,
    normY: number,
    faceC: number,
    start: number,
    end: number,
    radius: number,
    spacing: number
  ): number[] => {
    const indexes = new Set<number>();
    const stationCount = Math.max(1, Math.min(16, Math.ceil((end - start) / spacing)));
    for (let station = 0; station <= stationCount; station += 1) {
      const t = start + ((end - start) * station) / stationCount;
      const point = linePoint(dirX, dirY, normX, normY, faceC, t);
      wallGrid.forEachNear(point.x, point.y, radius, (wallIndex) => {
        indexes.add(wallIndex);
      });
    }
    return [...indexes];
  };

  const structuralSideSupports = (
    room: DetectedRoom,
    dirX: number,
    dirY: number,
    normX: number,
    normY: number,
    approximateFaceC: number,
    start: number,
    end: number
  ): RectangularEnvelopeSideSupport[] => {
    const span = end - start;
    if (!(span > 0)) {
      return [];
    }
    const candidates: RectangularEnvelopeWallCandidate[] = [];
    for (const wallIndex of queryWallIndexes(
      dirX,
      dirY,
      normX,
      normY,
      approximateFaceC,
      start,
      end,
      0.22 * doorGapMax,
      0.75 * doorGapMax
    )) {
      const wall = indexedWalls[wallIndex];
      if (Math.abs(wall.dirX * dirX + wall.dirY * dirY) < alignedDotMin) {
        continue;
      }
      const faceC = wallFaceCoordinate(wall, room, normX, normY);
      if (Math.abs(faceC - approximateFaceC) > structuralFaceTolerance) {
        continue;
      }
      const firstT = wall.x0 * dirX + wall.y0 * dirY;
      const secondT =
        (wall.x0 + wall.dirX * wall.length) * dirX +
        (wall.y0 + wall.dirY * wall.length) * dirY;
      const minT = Math.min(firstT, secondT);
      const maxT = Math.max(firstT, secondT);
      const overlap = Math.max(0, Math.min(end, maxT) - Math.max(start, minT));
      if (!(overlap > 0)) {
        continue;
      }
      candidates.push({ wall, faceC, minT, maxT, overlap });
    }
    candidates.sort((first, second) => first.faceC - second.faceC);
    const groups: RectangularEnvelopeWallCandidate[][] = [];
    for (const candidate of candidates) {
      let group = groups.find((current) => {
        const mean = current.reduce((sum, item) => sum + item.faceC, 0) / current.length;
        return Math.abs(candidate.faceC - mean) <= 0.08 * doorGapMax;
      });
      if (!group) {
        group = [];
        groups.push(group);
      }
      group.push(candidate);
    }
    const supports: RectangularEnvelopeSideSupport[] = [];
    for (const group of groups) {
      const intervals = group.map((candidate) => ({ start: candidate.minT, end: candidate.maxT }));
      const merged = mergeIntervals(intervals, start, end);
      if (!(merged.length > 0)) {
        continue;
      }
      let weightedFace = 0;
      let faceWeight = 0;
      let longest = group[0];
      for (const candidate of group) {
        weightedFace += candidate.faceC * candidate.overlap;
        faceWeight += candidate.overlap;
        if (candidate.wall.length > longest.wall.length) {
          longest = candidate;
        }
      }
      const firstGap = merged.first - start;
      const lastGap = end - merged.last;
      const startReach = intervalLengthWithin(intervals, start, Math.min(end, start + 0.5 * doorGapMax));
      const endReach = intervalLengthWithin(intervals, Math.max(start, end - 0.5 * doorGapMax), end);
      const full =
        merged.length / span >= 0.85 &&
        firstGap <= 0.2 * doorGapMax &&
        lastGap <= 0.2 * doorGapMax &&
        longest.wall.length >= minLongRun;
      const hybrid =
        merged.length / span >= 0.25 &&
        firstGap <= 0.15 * doorGapMax &&
        lastGap <= 0.15 * doorGapMax &&
        startReach >= 0.35 * doorGapMax &&
        endReach >= 0.35 * doorGapMax;
      supports.push({
        faceC: weightedFace / Math.max(faceWeight, epsilon),
        coverage: merged.length / span,
        longestRun: longest.wall.length,
        halfWidth: longest.wall.halfWidth,
        full,
        hybrid,
        overrunsStart: group.some((candidate) => start - candidate.minT >= 0.5 * doorGapMax),
        overrunsEnd: group.some((candidate) => candidate.maxT - end >= 0.5 * doorGapMax),
        overrunsBoth: group.some(
          (candidate) =>
            start - candidate.minT >= 0.5 * doorGapMax &&
            candidate.maxT - end >= 0.5 * doorGapMax
        )
      });
    }
    return supports.sort((first, second) =>
      Number(second.full) - Number(first.full) ||
      Number(second.hybrid) - Number(first.hybrid) ||
      second.coverage - first.coverage ||
      second.longestRun - first.longestRun ||
      Math.abs(first.faceC - approximateFaceC) - Math.abs(second.faceC - approximateFaceC)
    );
  };
  const contourCoverage = (
    polygon: ArrayLike<number>,
    dirX: number,
    dirY: number,
    normX: number,
    normY: number,
    faceC: number,
    start: number,
    end: number
  ): number => {
    const intervals: { start: number; end: number }[] = [];
    const vertexCount = polygon.length / 2;
    for (let index = 0; index < vertexCount; index += 1) {
      const next = (index + 1) % vertexCount;
      const x0 = polygon[index * 2];
      const y0 = polygon[index * 2 + 1];
      const x1 = polygon[next * 2];
      const y1 = polygon[next * 2 + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const length = Math.hypot(dx, dy);
      if (!(length > 0) || Math.abs((dx * dirX + dy * dirY) / length) < contourAlignedDotMin) {
        continue;
      }
      if (
        Math.abs(x0 * normX + y0 * normY - faceC) > contourFaceTolerance ||
        Math.abs(x1 * normX + y1 * normY - faceC) > contourFaceTolerance
      ) {
        continue;
      }
      const firstT = x0 * dirX + y0 * dirY;
      const secondT = x1 * dirX + y1 * dirY;
      intervals.push({ start: Math.min(firstT, secondT), end: Math.max(firstT, secondT) });
    }
    return mergeIntervals(intervals, start, end).length / Math.max(end - start, epsilon);
  };
  const rectanglePolygon = (
    uNormX: number,
    uNormY: number,
    vDirX: number,
    vDirY: number,
    u0: number,
    u1: number,
    v0: number,
    v1: number
  ): Float64Array => {
    const values = new Float64Array([
      uNormX * u0 + vDirX * v0,
      uNormY * u0 + vDirY * v0,
      uNormX * u1 + vDirX * v0,
      uNormY * u1 + vDirY * v0,
      uNormX * u1 + vDirX * v1,
      uNormY * u1 + vDirY * v1,
      uNormX * u0 + vDirX * v1,
      uNormY * u0 + vDirY * v1
    ]);
    return signedPolygonArea(values) > 0 ? values : reversePolygon(values);
  };

  let repairCount = 0;
  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
    const room = rooms[roomIndex];
    const polygon = room.polygon;
    const vertexCount = polygon.length / 2;
    if (vertexCount < 8 || !room.roomNumber || !/\d/.test(room.roomNumber)) {
      continue;
    }
    const oldArea = signedPolygonArea(polygon);
    if (!(oldArea > 0)) {
      continue;
    }
    const contourLines = collectContourLines(polygon);
    const missingProposals: {
      contour: RectangularEnvelopeContourLine;
      wall: PairedWallGeometry;
      gap: number;
    }[] = [];
    for (const contour of contourLines) {
      const range = contourLineRange(contour, contour.dirX, contour.dirY);
      const span = range.end - range.start;
      if (span < minMissingContourSpan) {
        continue;
      }
      const anchorC = room.labelX * contour.normX + room.labelY * contour.normY;
      const contourDistance = Math.abs(anchorC - contour.faceC);
      const nearby = new Set<number>();
      for (const fraction of [0.25, 0.5, 0.75]) {
        const point = linePoint(
          contour.dirX,
          contour.dirY,
          contour.normX,
          contour.normY,
          contour.faceC,
          range.start + fraction * span
        );
        wallGrid.forEachNear(point.x, point.y, 1.1 * doorGapMax, (wallIndex) => {
          nearby.add(wallIndex);
        });
      }
      for (const wallIndex of nearby) {
        const wall = indexedWalls[wallIndex];
        if (
          wall.length < minLongRun ||
          Math.abs(wall.dirX * contour.dirX + wall.dirY * contour.dirY) < alignedDotMin
        ) {
          continue;
        }
        const candidateFace = wallFaceCoordinate(wall, room, contour.normX, contour.normY);
        if ((candidateFace - anchorC) * (contour.faceC - anchorC) <= 0) {
          continue;
        }
        const gap = Math.abs(anchorC - candidateFace) - contourDistance;
        if (gap < minMissingOffset || gap > maxMissingOffset) {
          continue;
        }
        const firstT = wall.x0 * contour.dirX + wall.y0 * contour.dirY;
        const secondT =
          (wall.x0 + wall.dirX * wall.length) * contour.dirX +
          (wall.y0 + wall.dirY * wall.length) * contour.dirY;
        const overlap = Math.max(
          0,
          Math.min(range.end, Math.max(firstT, secondT)) -
            Math.max(range.start, Math.min(firstT, secondT))
        );
        if (overlap < 0.75 * span) {
          continue;
        }
        const midpoint = linePoint(
          contour.dirX,
          contour.dirY,
          contour.normX,
          contour.normY,
          candidateFace,
          0.5 * (range.start + range.end)
        );
        if (pointInPolygon(midpoint.x, midpoint.y, polygon)) {
          continue;
        }
        missingProposals.push({ contour, wall, gap });
      }
    }
    if (missingProposals.length === 0) {
      continue;
    }
    const nearestGapByContour = new Map<RectangularEnvelopeContourLine, number>();
    for (const proposal of missingProposals) {
      nearestGapByContour.set(
        proposal.contour,
        Math.min(nearestGapByContour.get(proposal.contour) ?? Infinity, proposal.gap)
      );
    }

    // Candidate discovery above is O(V*k). Keep only a small deterministic frontier
    // for the combinatorial envelope checks, otherwise a highly fragmented furniture
    // contour could turn this repair into a quadratic pass over polygon edges.
    const proposalFrontier = missingProposals
      .filter(
        (proposal) =>
          proposal.gap <= (nearestGapByContour.get(proposal.contour) ?? Infinity) + 0.08 * doorGapMax
      )
      .sort(
        (first, second) =>
          first.gap - second.gap ||
          second.contour.edgeLength - first.contour.edgeLength ||
          first.wall.index - second.wall.index
      )
      .slice(0, 12);

    let best: {
      polygon: Float64Array;
      area: number;
      gap: number;
      minCoverage: number;
      snapError: number;
    } | null = null;
    for (const proposal of proposalFrontier) {
      const sideDirX = proposal.wall.dirX;
      const sideDirY = proposal.wall.dirY;
      const uNormX = proposal.wall.normX;
      const uNormY = proposal.wall.normY;
      const missingU = faceForRoom(proposal.wall, room);
      const anchorU = room.labelX * uNormX + room.labelY * uNormY;
      const anchorV = room.labelX * sideDirX + room.labelY * sideDirY;

      const oppositeCandidates: {
        line: RectangularEnvelopeContourLine;
        support: RectangularEnvelopeSideSupport;
        faceU: number;
      }[] = [];
      for (const line of contourLines) {
        if (line === proposal.contour || Math.abs(line.dirX * sideDirX + line.dirY * sideDirY) < alignedDotMin) {
          continue;
        }
        const range = contourLineRange(line, sideDirX, sideDirY);
        if (
          range.end - range.start < minOppositeContourSpan ||
          range.end - range.start > maxEnvelopeSide + 0.4 * doorGapMax
        ) {
          continue;
        }
        const approximateU = contourLineCoordinate(line, uNormX, uNormY);
        if ((approximateU - anchorU) * (missingU - anchorU) >= 0) {
          continue;
        }
        for (const support of structuralSideSupports(
          room,
          sideDirX,
          sideDirY,
          uNormX,
          uNormY,
          approximateU,
          range.start,
          range.end
        ).filter((candidate) => candidate.full).slice(0, 2)) {
          if ((support.faceC - anchorU) * (missingU - anchorU) < 0) {
            oppositeCandidates.push({ line, support, faceU: support.faceC });
          }
        }
      }
      oppositeCandidates.sort((first, second) =>
        second.support.coverage - first.support.coverage ||
        Math.abs(first.faceU - anchorU) - Math.abs(second.faceU - anchorU)
      );

      for (const opposite of oppositeCandidates.slice(0, 4)) {
        const uStart = Math.min(missingU, opposite.faceU);
        const uEnd = Math.max(missingU, opposite.faceU);
        const width = uEnd - uStart;
        if (width < minEnvelopeSide || width > maxEnvelopeSide || !(anchorU > uStart && anchorU < uEnd)) {
          continue;
        }

        const firstAdjacent: {
          line: RectangularEnvelopeContourLine;
          support: RectangularEnvelopeSideSupport;
          faceV: number;
        }[] = [];
        const secondAdjacent: typeof firstAdjacent = [];
        for (const line of contourLines) {
          if (Math.abs(line.dirX * sideDirX + line.dirY * sideDirY) > perpendicularDotMax) {
            continue;
          }
          const approximateV = contourLineCoordinate(line, sideDirX, sideDirY);
          const supports = structuralSideSupports(
            room,
            uNormX,
            uNormY,
            sideDirX,
            sideDirY,
            approximateV,
            uStart,
            uEnd
          ).filter((support) => support.full || support.hybrid).slice(0, 2);
          for (const support of supports) {
            const entry = { line, support, faceV: support.faceC };
            if (support.faceC < anchorV) {
              firstAdjacent.push(entry);
            } else if (support.faceC > anchorV) {
              secondAdjacent.push(entry);
            }
          }
        }
        firstAdjacent.sort((first, second) =>
          Number(second.support.full) - Number(first.support.full) ||
          second.support.coverage - first.support.coverage ||
          second.faceV - first.faceV
        );
        secondAdjacent.sort((first, second) =>
          Number(second.support.full) - Number(first.support.full) ||
          second.support.coverage - first.support.coverage ||
          first.faceV - second.faceV
        );

        for (const first of firstAdjacent.slice(0, 4)) {
          for (const second of secondAdjacent.slice(0, 4)) {
            if (!first.support.full && !second.support.full) {
              continue;
            }
            const vStart = Math.min(first.faceV, second.faceV);
            const vEnd = Math.max(first.faceV, second.faceV);
            const height = vEnd - vStart;
            if (
              height < minEnvelopeSide ||
              height > maxEnvelopeSide ||
              width * height < minEnvelopeArea ||
              !(anchorV > vStart && anchorV < vEnd)
            ) {
              continue;
            }

            const missingSupport = structuralSideSupports(
              room,
              sideDirX,
              sideDirY,
              uNormX,
              uNormY,
              missingU,
              vStart,
              vEnd
            ).find((support) => support.full && Math.abs(support.faceC - missingU) <= 0.08 * doorGapMax);
            const oppositeSupport = structuralSideSupports(
              room,
              sideDirX,
              sideDirY,
              uNormX,
              uNormY,
              opposite.faceU,
              vStart,
              vEnd
            ).find((support) => support.full && Math.abs(support.faceC - opposite.faceU) <= 0.08 * doorGapMax);
            if (!missingSupport || !oppositeSupport) {
              continue;
            }

            const fullSupports = [missingSupport, oppositeSupport];
            if (first.support.full) {
              fullSupports.push(first.support);
            }
            if (second.support.full) {
              fullSupports.push(second.support);
            }
            if (fullSupports.length < 3) {
              continue;
            }
            const widths = [missingSupport, oppositeSupport, first.support, second.support].map(
              (support) => support.halfWidth
            );
            if (Math.max(...widths) > 1.75 * Math.min(...widths)) {
              continue;
            }
            if (
              !fullSupports.some((support) => support.overrunsBoth) &&
              fullSupports.filter((support) => support.overrunsStart || support.overrunsEnd).length < 2
            ) {
              continue;
            }

            const missingCoverage = contourCoverage(
              polygon,
              sideDirX,
              sideDirY,
              uNormX,
              uNormY,
              missingSupport.faceC,
              vStart,
              vEnd
            );
            const oppositeCoverage = contourCoverage(
              polygon,
              sideDirX,
              sideDirY,
              uNormX,
              uNormY,
              oppositeSupport.faceC,
              vStart,
              vEnd
            );
            const firstCoverage = contourCoverage(
              polygon,
              uNormX,
              uNormY,
              sideDirX,
              sideDirY,
              first.faceV,
              uStart,
              uEnd
            );
            const secondCoverage = contourCoverage(
              polygon,
              uNormX,
              uNormY,
              sideDirX,
              sideDirY,
              second.faceV,
              uStart,
              uEnd
            );
            if (
              missingCoverage >= 0.15 ||
              oppositeCoverage < 0.55 ||
              firstCoverage < 0.55 ||
              secondCoverage < 0.55 ||
              (!first.support.full && firstCoverage < 0.65) ||
              (!second.support.full && secondCoverage < 0.65)
            ) {
              continue;
            }

            const falseU = contourLineCoordinate(proposal.contour, uNormX, uNormY);
            const falseSupport = structuralSideSupports(
              room,
              sideDirX,
              sideDirY,
              uNormX,
              uNormY,
              falseU,
              vStart,
              vEnd
            )[0];
            if (falseSupport && falseSupport.coverage >= 0.6 && falseSupport.longestRun >= 0.5 * height) {
              continue;
            }

            let oldFitsExpandedEnvelope = true;
            for (let vertex = 0; vertex < vertexCount; vertex += 1) {
              const x = polygon[vertex * 2];
              const y = polygon[vertex * 2 + 1];
              const u = x * uNormX + y * uNormY;
              const v = x * sideDirX + y * sideDirY;
              if (
                u < uStart - expandedEnvelopeTolerance ||
                u > uEnd + expandedEnvelopeTolerance ||
                v < vStart - expandedEnvelopeTolerance ||
                v > vEnd + expandedEnvelopeTolerance
              ) {
                oldFitsExpandedEnvelope = false;
                break;
              }
            }
            if (!oldFitsExpandedEnvelope) {
              continue;
            }

            const replacement = rectanglePolygon(
              uNormX,
              uNormY,
              sideDirX,
              sideDirY,
              uStart,
              uEnd,
              vStart,
              vEnd
            );
            const replacementArea = signedPolygonArea(replacement);
            const addedArea = replacementArea - oldArea;
            if (
              addedArea < minAddedArea ||
              addedArea > maxAddedArea ||
              addedArea > 0.25 * oldArea ||
              !isSimplePolygon(replacement, epsilon) ||
              !pointInPolygon(room.labelX, room.labelY, replacement) ||
              !room.labels.every((label) =>
                pointInPolygon((label.minX + label.maxX) / 2, (label.minY + label.maxY) / 2, replacement)
              )
            ) {
              continue;
            }

            let capturesOtherAnchor = false;
            let overlapsAnotherRoom = false;
            const replacementBounds = polygonBounds(replacement);
            for (let otherIndex = 0; otherIndex < rooms.length; otherIndex += 1) {
              if (otherIndex === roomIndex) {
                continue;
              }
              const other = rooms[otherIndex];
              if (pointInPolygon(other.labelX, other.labelY, replacement)) {
                capturesOtherAnchor = true;
                break;
              }
              const otherBounds = polygonBounds(other.polygon);
              if (
                boundsHaveInteriorIntersection(replacementBounds, otherBounds, epsilon) &&
                polygonsHavePositiveAreaOverlap(replacement, other.polygon, replacementBounds, otherBounds, epsilon)
              ) {
                overlapsAnotherRoom = true;
                break;
              }
            }
            if (capturesOtherAnchor || overlapsAnotherRoom) {
              continue;
            }

            const minCoverage = Math.min(oppositeCoverage, firstCoverage, secondCoverage);
            const snapError =
              Math.abs(opposite.faceU - contourLineCoordinate(opposite.line, uNormX, uNormY)) +
              Math.abs(first.faceV - contourLineCoordinate(first.line, sideDirX, sideDirY)) +
              Math.abs(second.faceV - contourLineCoordinate(second.line, sideDirX, sideDirY));
            if (
              !best ||
              proposal.gap < best.gap - epsilon ||
              (Math.abs(proposal.gap - best.gap) <= epsilon && minCoverage > best.minCoverage + epsilon) ||
              (Math.abs(proposal.gap - best.gap) <= epsilon &&
                Math.abs(minCoverage - best.minCoverage) <= epsilon &&
                addedArea < best.area - oldArea - epsilon) ||
              (Math.abs(proposal.gap - best.gap) <= epsilon &&
                Math.abs(minCoverage - best.minCoverage) <= epsilon &&
                Math.abs(addedArea - (best.area - oldArea)) <= epsilon &&
                snapError < best.snapError)
            ) {
              best = { polygon: replacement, area: replacementArea, gap: proposal.gap, minCoverage, snapError };
            }
          }
        }
      }
    }

    if (best) {
      room.polygon = new Float32Array(best.polygon);
      room.area = best.area;
      repairCount += 1;
    }
  }
  return repairCount;
}

/**
 * Prefer the high-accuracy snapped/offset polygon, but retreat to its pre-offset form,
 * exact raster contour, and then progressively deeper sub-pixel contour insets when
 * geometry processing violates the room-cell topology. These levels handle rare
 * interleaving, hole-riddled components whose single outer-ring representations still
 * cross even though their raster pixels are disjoint. If every simple fallback remains
 * conflicted, a deterministic minimum-loss suppression is the final safety net.
 */
function repairRoomGeometryConflicts(
  rooms: DetectedRoom[],
  preOffsetPolygons: Float32Array[],
  rawPolygons: Float32Array[],
  rasterScale: number
): { repairCount: number; suppressedRoomIndices: Set<number> } {
  const count = Math.min(rooms.length, preOffsetPolygons.length, rawPolygons.length);
  if (count === 0) {
    return { repairCount: 0, suppressedRoomIndices: new Set() };
  }

  // Float32 output coordinates either share the exact same boundary value or differ by
  // much more than this absolute tolerance. Page-scaled epsilons can hide long, narrow
  // crossings whose integrated area is positive, so topology deliberately stays strict.
  const epsilon = 1e-9;
  const insetDistancesPx = [0.55, 1.1, 2.2, 4.4, 8.8];
  const insetRawPolygons: Array<Array<Float32Array | null>> = insetDistancesPx.map(() =>
    Array<Float32Array | null>(count).fill(null)
  );
  const insetRawIsSimple = insetDistancesPx.map(() => new Int8Array(count).fill(-1));
  const insetPolygon = (insetIndex: number, roomIndex: number): Float32Array => {
    let polygon = insetRawPolygons[insetIndex][roomIndex];
    if (!polygon) {
      polygon = new Float32Array(
        offsetPolygonOutward(
          rawPolygons[roomIndex],
          -insetDistancesPx[insetIndex] / Math.max(rasterScale, 1e-9)
        )
      );
      insetRawPolygons[insetIndex][roomIndex] = polygon;
    }
    return polygon;
  };
  const insetIsSimple = (insetIndex: number, roomIndex: number): boolean => {
    const cached = insetRawIsSimple[insetIndex][roomIndex];
    if (cached >= 0) {
      return cached === 1;
    }
    const simple = isSimplePolygon(insetPolygon(insetIndex, roomIndex), epsilon);
    insetRawIsSimple[insetIndex][roomIndex] = simple ? 1 : 0;
    return simple;
  };
  const preOffsetSimpleState = new Int8Array(count).fill(-1);
  const rawSimpleState = new Int8Array(count).fill(-1);
  const cachedSimple = (state: Int8Array, polygon: ArrayLike<number>, index: number): boolean => {
    if (state[index] < 0) {
      state[index] = isSimplePolygon(polygon, epsilon) ? 1 : 0;
    }
    return state[index] === 1;
  };
  const preOffsetIsSimple = (index: number): boolean =>
    cachedSimple(preOffsetSimpleState, preOffsetPolygons[index], index);
  const rawIsSimple = (index: number): boolean => cachedSimple(rawSimpleState, rawPolygons[index], index);
  const maxLevel = 2 + insetDistancesPx.length;
  // 0 = offset, 1 = pre-offset, 2 = raw, 3+ = successively deeper raw insets.
  const levels = new Uint8Array(count);
  const advance = (index: number): boolean => {
    const previous = levels[index];
    for (let candidate = previous + 1; candidate <= maxLevel; candidate += 1) {
      if (
        (candidate === 1 && preOffsetIsSimple(index)) ||
        (candidate === 2 && rawIsSimple(index)) ||
        (candidate >= 3 && insetIsSimple(candidate - 3, index))
      ) {
        levels[index] = candidate;
        return true;
      }
    }
    return false;
  };
  const selected = (index: number): ArrayLike<number> =>
    levels[index] === 0
      ? rooms[index].polygon
      : levels[index] === 1
        ? preOffsetPolygons[index]
        : levels[index] === 2
          ? rawPolygons[index]
          : insetPolygon(levels[index] - 3, index);

  for (let index = 0; index < count; index += 1) {
    if (!isSimplePolygon(rooms[index].polygon, epsilon)) {
      advance(index);
    }
  }

  // Advancing one polygon can reveal an overlap with a third polygon, so resolve from
  // immutable snapshots until the finite fallback chain stabilizes.
  let unresolvedConflictPairs: Array<[number, number]> = [];
  for (let pass = 0; pass <= count * maxLevel; pass += 1) {
    const bounds = Array.from({ length: count }, (_, index) => polygonBounds(selected(index)));
    const conflicted = new Uint8Array(count);
    const conflictPairs: Array<[number, number]> = [];
    for (let first = 0; first < count; first += 1) {
      for (let second = first + 1; second < count; second += 1) {
        if (!boundsHaveInteriorIntersection(bounds[first], bounds[second], epsilon)) {
          continue;
        }
        if (polygonsHavePositiveAreaOverlap(selected(first), selected(second), bounds[first], bounds[second], epsilon)) {
          conflicted[first] = 1;
          conflicted[second] = 1;
          conflictPairs.push([first, second]);
        }
      }
    }

    let changed = false;
    for (let index = 0; index < count; index += 1) {
      if (conflicted[index] !== 0) {
        changed = advance(index) || changed;
      }
    }
    if (!changed) {
      unresolvedConflictPairs = conflictPairs;
      break;
    }
  }

  let repairCount = 0;
  for (let index = 0; index < count; index += 1) {
    if (levels[index] === 0) {
      continue;
    }
    const repaired = levels[index] === 1
      ? preOffsetPolygons[index]
      : levels[index] === 2
        ? rawPolygons[index]
        : insetPolygon(levels[index] - 3, index);
    rooms[index].polygon = new Float32Array(repaired);
    rooms[index].area = Math.abs(signedPolygonArea(repaired));
    repairCount += 1;
  }
  const invalidRoomIndices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (!isSimplePolygon(rooms[index].polygon, epsilon)) {
      invalidRoomIndices.push(index);
    }
  }
  return {
    repairCount,
    suppressedRoomIndices: chooseGeometryConflictSuppressions(rooms, unresolvedConflictPairs, invalidRoomIndices)
  };
}

function chooseGeometryConflictSuppressions(
  rooms: DetectedRoom[],
  conflictPairs: Array<[number, number]>,
  invalidRoomIndices: number[]
): Set<number> {
  const suppressed = new Set<number>(invalidRoomIndices);
  let remaining = conflictPairs.filter(([first, second]) => !suppressed.has(first) && !suppressed.has(second));
  const evidenceScore = (index: number): number => {
    const room = rooms[index];
    return (
      (room.roomNumber.length > 0 ? 4 : 0) +
      (room.labelText.trim().length > 0 ? 2 : 0) +
      (room.hasDoorEvidence ? 1 : 0) +
      room.confidence
    );
  };

  // Greedy vertex cover: remove the room participating in the most remaining conflicts,
  // then use room evidence, size, and stable index only as deterministic tie-breaks.
  while (remaining.length > 0) {
    const degree = new Int32Array(rooms.length);
    for (const [first, second] of remaining) {
      degree[first] += 1;
      degree[second] += 1;
    }
    let loser = remaining[0][0];
    for (let index = 0; index < degree.length; index += 1) {
      if (degree[index] === 0) {
        continue;
      }
      const weaker =
        degree[index] > degree[loser] ||
        (degree[index] === degree[loser] && evidenceScore(index) < evidenceScore(loser)) ||
        (degree[index] === degree[loser] && evidenceScore(index) === evidenceScore(loser) && rooms[index].area < rooms[loser].area) ||
        (degree[index] === degree[loser] && evidenceScore(index) === evidenceScore(loser) && rooms[index].area === rooms[loser].area && index > loser);
      if (weaker) {
        loser = index;
      }
    }
    suppressed.add(loser);
    remaining = remaining.filter(([first, second]) => first !== loser && second !== loser);
  }
  return suppressed;
}

function boundsHaveInteriorIntersection(first: PolygonBounds, second: PolygonBounds, epsilon: number): boolean {
  return (
    Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX) > epsilon &&
    Math.min(first.maxY, second.maxY) - Math.max(first.minY, second.minY) > epsilon
  );
}

function isSimplePolygon(polygon: ArrayLike<number>, epsilon: number): boolean {
  const vertexCount = polygon.length / 2;
  if (polygon.length < 6 || polygon.length % 2 !== 0 || signedPolygonArea(polygon) <= epsilon * epsilon) {
    return false;
  }
  for (let i = 0; i < polygon.length; i += 1) {
    if (!Number.isFinite(polygon[i])) {
      return false;
    }
  }
  for (let first = 0; first < vertexCount; first += 1) {
    const firstNext = (first + 1) % vertexCount;
    const ax = polygon[first * 2];
    const ay = polygon[first * 2 + 1];
    const bx = polygon[firstNext * 2];
    const by = polygon[firstNext * 2 + 1];
    if (Math.hypot(bx - ax, by - ay) <= epsilon) {
      return false;
    }
    for (let second = first + 1; second < vertexCount; second += 1) {
      const secondNext = (second + 1) % vertexCount;
      if (first === second || firstNext === second || secondNext === first) {
        continue;
      }
      if (
        segmentsIntersectInclusive(
          ax,
          ay,
          bx,
          by,
          polygon[second * 2],
          polygon[second * 2 + 1],
          polygon[secondNext * 2],
          polygon[secondNext * 2 + 1],
          epsilon
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function segmentsIntersectInclusive(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  epsilon: number
): boolean {
  if (
    Math.max(ax, bx) + epsilon < Math.min(cx, dx) ||
    Math.max(cx, dx) + epsilon < Math.min(ax, bx) ||
    Math.max(ay, by) + epsilon < Math.min(cy, dy) ||
    Math.max(cy, dy) + epsilon < Math.min(ay, by)
  ) {
    return false;
  }
  const abC = crossProduct(ax, ay, bx, by, cx, cy);
  const abD = crossProduct(ax, ay, bx, by, dx, dy);
  const cdA = crossProduct(cx, cy, dx, dy, ax, ay);
  const cdB = crossProduct(cx, cy, dx, dy, bx, by);
  const tolerance = epsilon * Math.max(1, Math.hypot(bx - ax, by - ay), Math.hypot(dx - cx, dy - cy));
  if (((abC > tolerance && abD < -tolerance) || (abC < -tolerance && abD > tolerance)) &&
      ((cdA > tolerance && cdB < -tolerance) || (cdA < -tolerance && cdB > tolerance))) {
    return true;
  }
  return (
    (Math.abs(abC) <= tolerance && pointOnSegment(cx, cy, ax, ay, bx, by, epsilon)) ||
    (Math.abs(abD) <= tolerance && pointOnSegment(dx, dy, ax, ay, bx, by, epsilon)) ||
    (Math.abs(cdA) <= tolerance && pointOnSegment(ax, ay, cx, cy, dx, dy, epsilon)) ||
    (Math.abs(cdB) <= tolerance && pointOnSegment(bx, by, cx, cy, dx, dy, epsilon))
  );
}

function segmentsCrossProperly(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  epsilon: number
): boolean {
  const tolerance = epsilon * Math.max(1, Math.hypot(bx - ax, by - ay), Math.hypot(dx - cx, dy - cy));
  const abC = crossProduct(ax, ay, bx, by, cx, cy);
  const abD = crossProduct(ax, ay, bx, by, dx, dy);
  const cdA = crossProduct(cx, cy, dx, dy, ax, ay);
  const cdB = crossProduct(cx, cy, dx, dy, bx, by);
  return (
    ((abC > tolerance && abD < -tolerance) || (abC < -tolerance && abD > tolerance)) &&
    ((cdA > tolerance && cdB < -tolerance) || (cdA < -tolerance && cdB > tolerance))
  );
}

function crossProduct(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointOnSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  epsilon: number
): boolean {
  if (x < Math.min(ax, bx) - epsilon || x > Math.max(ax, bx) + epsilon || y < Math.min(ay, by) - epsilon || y > Math.max(ay, by) + epsilon) {
    return false;
  }
  return Math.abs(crossProduct(ax, ay, bx, by, x, y)) <= epsilon * Math.max(1, Math.hypot(bx - ax, by - ay));
}

function pointInPolygonStrict(x: number, y: number, polygon: ArrayLike<number>, epsilon: number): boolean {
  const vertexCount = polygon.length / 2;
  for (let i = 0; i < vertexCount; i += 1) {
    const next = (i + 1) % vertexCount;
    if (pointOnSegment(x, y, polygon[i * 2], polygon[i * 2 + 1], polygon[next * 2], polygon[next * 2 + 1], epsilon)) {
      return false;
    }
  }
  return pointInPolygon(x, y, polygon);
}

function polygonsHavePositiveAreaOverlap(
  first: ArrayLike<number>,
  second: ArrayLike<number>,
  firstBounds: PolygonBounds,
  secondBounds: PolygonBounds,
  epsilon: number
): boolean {
  const firstCount = first.length / 2;
  const secondCount = second.length / 2;
  for (let firstIndex = 0; firstIndex < firstCount; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % firstCount;
    for (let secondIndex = 0; secondIndex < secondCount; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % secondCount;
      if (
        segmentsCrossProperly(
          first[firstIndex * 2],
          first[firstIndex * 2 + 1],
          first[firstNext * 2],
          first[firstNext * 2 + 1],
          second[secondIndex * 2],
          second[secondIndex * 2 + 1],
          second[secondNext * 2],
          second[secondNext * 2 + 1],
          epsilon
        )
      ) {
        return true;
      }
    }
  }

  for (let index = 0; index < firstCount; index += 1) {
    if (pointInPolygonStrict(first[index * 2], first[index * 2 + 1], second, epsilon)) {
      return true;
    }
  }
  for (let index = 0; index < secondCount; index += 1) {
    if (pointInPolygonStrict(second[index * 2], second[index * 2 + 1], first, epsilon)) {
      return true;
    }
  }

  // Collinear, partially coincident polygons can overlap without a proper crossing or
  // a strictly interior vertex. Between consecutive vertex Y coordinates, scanline
  // topology is constant; test one midpoint in each band. A shared boundary alone has
  // no interval with positive width and remains valid.
  return polygonsHaveScanlineOverlap(first, second, firstBounds, secondBounds, epsilon);
}

function polygonIntervalsAtY(polygon: ArrayLike<number>, y: number): number[] {
  const crossings: number[] = [];
  const vertexCount = polygon.length / 2;
  for (let index = 0; index < vertexCount; index += 1) {
    const next = (index + 1) % vertexCount;
    const leftY = polygon[index * 2 + 1];
    const rightY = polygon[next * 2 + 1];
    if ((leftY > y) !== (rightY > y)) {
      const leftX = polygon[index * 2];
      crossings.push(leftX + ((polygon[next * 2] - leftX) * (y - leftY)) / (rightY - leftY));
    }
  }
  crossings.sort((left, right) => left - right);
  return crossings;
}

function polygonsHaveScanlineOverlap(
  first: ArrayLike<number>,
  second: ArrayLike<number>,
  firstBounds: PolygonBounds,
  secondBounds: PolygonBounds,
  epsilon: number
): boolean {
  const minY = Math.max(firstBounds.minY, secondBounds.minY);
  const maxY = Math.min(firstBounds.maxY, secondBounds.maxY);
  const levels: number[] = [minY, maxY];
  for (const polygon of [first, second]) {
    for (let index = 1; index < polygon.length; index += 2) {
      if (polygon[index] > minY + epsilon && polygon[index] < maxY - epsilon) {
        levels.push(polygon[index]);
      }
    }
  }
  levels.sort((left, right) => left - right);
  const uniqueLevels: number[] = [];
  for (const level of levels) {
    if (uniqueLevels.length === 0 || level - uniqueLevels[uniqueLevels.length - 1] > epsilon) {
      uniqueLevels.push(level);
    }
  }

  for (let levelIndex = 0; levelIndex + 1 < uniqueLevels.length; levelIndex += 1) {
    if (uniqueLevels[levelIndex + 1] - uniqueLevels[levelIndex] <= 2 * epsilon) {
      continue;
    }
    const y = (uniqueLevels[levelIndex] + uniqueLevels[levelIndex + 1]) / 2;
    const firstIntervals = polygonIntervalsAtY(first, y);
    const secondIntervals = polygonIntervalsAtY(second, y);
    let firstIndex = 0;
    let secondIndex = 0;
    while (firstIndex + 1 < firstIntervals.length && secondIndex + 1 < secondIntervals.length) {
      const overlapWidth = Math.min(firstIntervals[firstIndex + 1], secondIntervals[secondIndex + 1]) -
        Math.max(firstIntervals[firstIndex], secondIntervals[secondIndex]);
      if (overlapWidth > epsilon) {
        return true;
      }
      if (firstIntervals[firstIndex + 1] < secondIntervals[secondIndex + 1]) {
        firstIndex += 2;
      } else {
        secondIndex += 2;
      }
    }
  }
  return false;
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
