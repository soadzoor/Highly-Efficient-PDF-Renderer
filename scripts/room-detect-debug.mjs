/**
 * Headless room-detection debug harness.
 *
 * Loads example floorplan PDFs through the real extractor in Node (via Vite SSR module
 * loading), runs detectRooms, prints per-page statistics, and renders the detection
 * result (walls, closures, rooms, seeds) into PNG snapshots under .debug/.
 *
 * Usage:
 *   node scripts/room-detect-debug.mjs "LK Office Level 1.pdf" [more.pdf ...]
 *   node scripts/room-detect-debug.mjs --all            # the four reference floorplans
 *   node scripts/room-detect-debug.mjs --gt [substring] # evaluate against the TSV ground
 *     truth in public/examples/rooms/accurate_rooms (optionally filtered by substring)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import zlib from "node:zlib";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const pdfDir = path.resolve(repoRootDir, "public", "examples", "pdfs");
const gtDir = path.resolve(repoRootDir, "public", "examples", "rooms", "accurate_rooms");
const outDir = path.resolve(repoRootDir, ".debug");

const REFERENCE_PDFS = [
  "LK Office Level 1.pdf",
  "SimiValleyBehavioralHealth_SR_20180403.pdf",
  "Dublin 1st Floor 2018 06 01.pdf",
  "Murietta_Level1.pdf"
];

const IMAGE_MAX_SIZE = 2200;

// Optional crop: --crop fx0,fy0,fx1,fy1 (fractions of the page, origin top-left).
let cropFractions = null;

async function main() {
  const args = process.argv.slice(2);
  const gtMode = args.includes("--gt");
  const cropArgIndex = args.findIndex((arg) => arg === "--crop");
  if (cropArgIndex >= 0 && args[cropArgIndex + 1]) {
    const parts = args[cropArgIndex + 1].split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      cropFractions = parts;
    }
    args.splice(cropArgIndex, 2);
  }
  let extraOptions = {};
  const optsArgIndex = args.findIndex((arg) => arg === "--opts");
  if (optsArgIndex >= 0 && args[optsArgIndex + 1]) {
    extraOptions = JSON.parse(args[optsArgIndex + 1]);
    args.splice(optsArgIndex, 2);
  }
  const positional = args.filter((arg) => !arg.startsWith("--"));

  let targets;
  if (gtMode) {
    const allGt = (await fs.readdir(gtDir)).filter((file) => file.endsWith(".pdf"));
    const filter = positional[0]?.toLowerCase();
    targets = allGt
      .filter((file) => !filter || file.toLowerCase().includes(filter))
      .map((file) => ({ name: file, filePath: path.resolve(gtDir, file), tsvPath: path.resolve(gtDir, file.replace(/\.pdf$/, ".tsv")) }));
  } else {
    const names = args.includes("--all") ? REFERENCE_PDFS : positional;
    targets = names.map((name) => ({ name, filePath: path.resolve(pdfDir, name), tsvPath: null }));
  }
  if (targets.length === 0) {
    console.error("Usage: node scripts/room-detect-debug.mjs <pdf name in public/examples/pdfs> | --all | --gt [substring]");
    process.exit(1);
  }

  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    root: repoRootDir,
    logLevel: "warn",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true }
  });

  try {
    let loadModule;
    if (typeof server.ssrLoadModule === "function") {
      loadModule = (id) => server.ssrLoadModule(id);
    } else {
      const { createServerModuleRunner } = await import("vite");
      const runner = createServerModuleRunner(server.environments.ssr);
      loadModule = (id) => runner.import(id);
    }

    const extractor = await loadModule("/src/pdfVectorExtractor.ts");
    const detector = await loadModule("/src/roomDetector.ts");

    await fs.mkdir(outDir, { recursive: true });

    for (const target of targets) {
      const { name, filePath, tsvPath } = target;
      console.log(`\n=== ${name} ===`);
      const bytes = await fs.readFile(filePath);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

      const parseStart = performance.now();
      const pageScenes = await extractor.extractPdfPageScenes(buffer, {
        extractTextContent: true
      });
      const scene = extractor.composeVectorScenesInGrid(pageScenes, 10);
      const parseMs = performance.now() - parseStart;
      console.log(
        `parsed ${pageScenes.length} page(s), ${scene.segmentCount} segments, ` +
          `${scene.textContent?.length ?? 0} text items in ${parseMs.toFixed(0)} ms`
      );

      const detectStart = performance.now();
      const result = detector.detectRooms(scene, { collectDebugInfo: true, ...extraOptions });
      const detectMs = performance.now() - detectStart;

      printResult(result, detectMs, !gtMode);
      const stem = path.parse(name).name.replaceAll(" ", "_");
      const imagePath = path.resolve(outDir, `${stem}.png`);

      let groundTruth = null;
      if (tsvPath) {
        groundTruth = await loadGroundTruth(tsvPath, scene);
        evaluateAgainstGroundTruth(scene, result, groundTruth);
      }

      await renderResultPng(scene, result, imagePath, groundTruth);
      const regionsPath = path.resolve(outDir, `${stem}_regions.png`);
      await renderRegionsPng(result, regionsPath);
      console.log(`wrote ${path.relative(repoRootDir, imagePath)} and ${path.relative(repoRootDir, regionsPath)}`);
    }
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------------------
// Ground-truth evaluation
// ---------------------------------------------------------------------------

/**
 * The TSV room polygons live in a coordinate space translated relative to scene space
 * (origin at the page center). Returns { rooms: [{ roomNumber, polygon: number[] }] }
 * with polygons already converted to scene coordinates.
 */
async function loadGroundTruth(tsvPath, scene) {
  const pageCenterX = (scene.pageRects[0] + scene.pageRects[2]) / 2;
  const pageCenterY = (scene.pageRects[1] + scene.pageRects[3]) / 2;
  const tsv = await fs.readFile(tsvPath, "utf8");
  const rooms = [];
  for (const line of tsv.split("\n").slice(1)) {
    const tabIndex = line.indexOf("\t");
    if (tabIndex < 0) {
      continue;
    }
    const roomNumber = line.slice(0, tabIndex).trim();
    let points;
    try {
      points = JSON.parse(line.slice(tabIndex + 1));
    } catch {
      continue;
    }
    if (!Array.isArray(points) || points.length < 3) {
      continue;
    }
    const polygon = [];
    for (const point of points) {
      polygon.push(point.x + pageCenterX, point.y + pageCenterY);
    }
    rooms.push({ roomNumber, polygon });
  }
  return { rooms };
}

function evaluateAgainstGroundTruth(scene, result, groundTruth) {
  // Rasterize GT and detected rooms into id maps at a modest resolution, then build the
  // full intersection matrix in one pass.
  const bounds = scene.pageBounds;
  const scale = 1600 / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const width = Math.ceil((bounds.maxX - bounds.minX) * scale) + 2;
  const height = Math.ceil((bounds.maxY - bounds.minY) * scale) + 2;
  const toRaster = (polygon) => {
    const out = [];
    for (let i = 0; i + 1 < polygon.length; i += 2) {
      out.push([(polygon[i] - bounds.minX) * scale + 1, (bounds.maxY - polygon[i + 1]) * scale + 1]);
    }
    return out;
  };

  const gtMap = new Uint16Array(width * height);
  const detMap = new Uint16Array(width * height);
  const gtAreas = new Map();
  const detAreas = new Map();
  for (const [index, room] of groundTruth.rooms.entries()) {
    fillPolygonId(gtMap, width, height, toRaster(room.polygon), index + 1);
  }
  for (const [index, room] of result.rooms.entries()) {
    fillPolygonId(detMap, width, height, toRaster(Array.from(room.polygon)), index + 1);
  }
  const intersections = new Map();
  for (let i = 0; i < gtMap.length; i += 1) {
    const gtId = gtMap[i];
    const detId = detMap[i];
    if (gtId) {
      gtAreas.set(gtId, (gtAreas.get(gtId) ?? 0) + 1);
    }
    if (detId) {
      detAreas.set(detId, (detAreas.get(detId) ?? 0) + 1);
    }
    if (gtId && detId) {
      const key = gtId * 100000 + detId;
      intersections.set(key, (intersections.get(key) ?? 0) + 1);
    }
  }

  // Greedy one-to-one matching by IoU descending.
  const pairs = [];
  for (const [key, intersection] of intersections) {
    const gtId = Math.floor(key / 100000);
    const detId = key % 100000;
    const union = (gtAreas.get(gtId) ?? 0) + (detAreas.get(detId) ?? 0) - intersection;
    if (union > 0) {
      pairs.push({ gtId, detId, iou: intersection / union });
    }
  }
  pairs.sort((a, b) => b.iou - a.iou);
  const gtMatched = new Map();
  const detMatched = new Set();
  for (const pair of pairs) {
    if (gtMatched.has(pair.gtId) || detMatched.has(pair.detId)) {
      continue;
    }
    gtMatched.set(pair.gtId, pair);
    detMatched.add(pair.detId);
  }

  const ious = [...gtMatched.values()].map((pair) => pair.iou);
  const recallAt = (threshold) => ious.filter((iou) => iou >= threshold).length / Math.max(1, groundTruth.rooms.length);
  const matchedDetections = [...gtMatched.values()].filter((pair) => pair.iou >= 0.5);
  let labelHits = 0;
  for (const pair of matchedDetections) {
    const gtRoom = groundTruth.rooms[pair.gtId - 1];
    const detRoom = result.rooms[pair.detId - 1];
    if (detRoom.labelText.toLowerCase().includes(gtRoom.roomNumber.toLowerCase())) {
      labelHits += 1;
    }
  }
  const meanIou = ious.length > 0 ? ious.reduce((sum, iou) => sum + iou, 0) / ious.length : 0;
  console.log(
    `GT: ${groundTruth.rooms.length} rooms | detections: ${result.rooms.length} | ` +
      `recall@0.5=${(recallAt(0.5) * 100).toFixed(1)}% recall@0.7=${(recallAt(0.7) * 100).toFixed(1)}% ` +
      `precision@0.5=${((matchedDetections.length / Math.max(1, result.rooms.length)) * 100).toFixed(1)}% ` +
      `meanIoU(matched)=${meanIou.toFixed(3)} labelAcc=${labelHits}/${matchedDetections.length}`
  );

  // Worst GT misses, to guide tuning.
  const misses = groundTruth.rooms
    .map((room, index) => ({ room, iou: gtMatched.get(index + 1)?.iou ?? 0, area: gtAreas.get(index + 1) ?? 0 }))
    .filter((entry) => entry.iou < 0.5)
    .sort((a, b) => b.area - a.area);
  if (misses.length > 0) {
    const sample = misses.slice(0, 10).map((entry) => `${entry.room.roomNumber}(${entry.iou.toFixed(2)})`).join(" ");
    console.log(`  missed GT rooms (${misses.length}): ${sample}${misses.length > 10 ? " ..." : ""}`);
  }
}

function fillPolygonId(idMap, width, height, points, id) {
  if (points.length < 3) {
    return;
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(height - 1, Math.ceil(maxY)); y += 1) {
    const sampleY = y + 0.5;
    const crossings = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if (y0 <= sampleY === y1 <= sampleY) {
        continue;
      }
      crossings.push(x0 + ((sampleY - y0) / (y1 - y0)) * (x1 - x0));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const startX = Math.max(0, Math.round(crossings[i]));
      const endX = Math.min(width - 1, Math.round(crossings[i + 1]));
      for (let x = startX; x <= endX; x += 1) {
        idMap[y * width + x] = id;
      }
    }
  }
}

function printResult(result, detectMs, listRooms = true) {
  for (const [pageIndex, stats] of result.debug?.pageStats ?? new Map()) {
    console.log(
      `page ${pageIndex}: eligible=${stats.eligibleSegmentCount} totalLen=${stats.totalStrokeLength.toFixed(0)} ` +
        `wallThreshold=${stats.wallHalfWidthThreshold.toFixed(4)} wallMedianHw=${stats.wallMedianHalfWidth.toFixed(4)} ` +
        `walls=${stats.wallSegmentCount} closures=${stats.closureCount} ` +
        `doorGapMax=${stats.doorGapMax.toFixed(2)} raster=${stats.rasterWidth}x${stats.rasterHeight} seeds=${stats.seedCount}`
    );
    const histogram = stats.widthHistogram
      .map((bucket) => `${bucket.halfWidth.toFixed(3)}:${bucket.totalLength.toFixed(0)}(${bucket.segmentCount})`)
      .join("  ");
    console.log(`  width histogram (hw:len(count)): ${histogram}`);
  }

  const closures = result.debug?.virtualClosures ?? new Float32Array(0);
  const closureLengths = [];
  for (let i = 0; i + 3 < closures.length; i += 4) {
    closureLengths.push(Math.hypot(closures[i + 2] - closures[i], closures[i + 3] - closures[i + 1]));
  }
  if (closureLengths.length > 0) {
    closureLengths.sort((a, b) => a - b);
    console.log(
      `closure lengths: min=${closureLengths[0].toFixed(1)} ` +
        `median=${closureLengths[Math.floor(closureLengths.length / 2)].toFixed(1)} ` +
        `max=${closureLengths[closureLengths.length - 1].toFixed(1)}`
    );
  }

  const failureCounts = new Map();
  for (const failure of result.failedSeeds) {
    failureCounts.set(failure.reason, (failureCounts.get(failure.reason) ?? 0) + 1);
  }
  console.log(
    `rooms=${result.rooms.length} failedSeeds=${result.failedSeeds.length} ` +
      `(${[...failureCounts.entries()].map(([reason, count]) => `${reason}:${count}`).join(", ")}) in ${detectMs.toFixed(0)} ms`
  );
  if (!listRooms) {
    return;
  }
  for (const [index, room] of result.rooms.entries()) {
    const label = room.labelText.replaceAll("\n", " | ");
    console.log(`  room ${index}: area=${room.area.toFixed(0)} vertices=${room.polygon.length / 2} label="${label}"`);
  }
}

// ---------------------------------------------------------------------------
// PNG rendering
// ---------------------------------------------------------------------------

async function renderResultPng(scene, result, imagePath, groundTruth = null) {
  let bounds = scene.pageBounds;
  if (cropFractions) {
    const [fx0, fy0, fx1, fy1] = cropFractions;
    const fullWidth = bounds.maxX - bounds.minX;
    const fullHeight = bounds.maxY - bounds.minY;
    // Fractions are top-left based; world Y is up.
    bounds = {
      minX: bounds.minX + fx0 * fullWidth,
      maxX: bounds.minX + fx1 * fullWidth,
      minY: bounds.maxY - fy1 * fullHeight,
      maxY: bounds.maxY - fy0 * fullHeight
    };
  }
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  const scale = IMAGE_MAX_SIZE / Math.max(worldWidth, worldHeight);
  const pad = 8;
  const width = Math.ceil(worldWidth * scale) + pad * 2;
  const height = Math.ceil(worldHeight * scale) + pad * 2;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);

  const toX = (wx) => (wx - bounds.minX) * scale + pad;
  const toY = (wy) => (bounds.maxY - wy) * scale + pad;

  // All strokes, light gray.
  const endpoints = scene.endpoints;
  const primitiveMeta = scene.primitiveMeta;
  for (let i = 0; i < scene.segmentCount; i += 1) {
    const base = i * 4;
    const x0 = endpoints[base];
    const y0 = endpoints[base + 1];
    const x1 = primitiveMeta[base];
    const y1 = primitiveMeta[base + 1];
    drawLine(rgba, width, height, toX(x0), toY(y0), toX(x1), toY(y1), 0.6, [185, 185, 185, 255]);
  }

  // Room fills + outlines.
  const palette = [
    [230, 70, 70],
    [60, 140, 230],
    [70, 180, 90],
    [230, 150, 50],
    [160, 90, 220],
    [40, 180, 190],
    [220, 90, 170],
    [150, 160, 40]
  ];
  for (const [index, room] of result.rooms.entries()) {
    const color = palette[index % palette.length];
    const points = [];
    for (let i = 0; i + 1 < room.polygon.length; i += 2) {
      points.push([toX(room.polygon[i]), toY(room.polygon[i + 1])]);
    }
    fillPolygon(rgba, width, height, points, [...color, 70]);
    for (let i = 0; i < points.length; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      drawLine(rgba, width, height, x0, y0, x1, y1, 1.2, [...color, 255]);
    }
  }

  // Wall candidates (red) and closures (blue) on top.
  const walls = result.debug?.wallSegments ?? new Float32Array(0);
  for (let i = 0; i + 3 < walls.length; i += 4) {
    drawLine(rgba, width, height, toX(walls[i]), toY(walls[i + 1]), toX(walls[i + 2]), toY(walls[i + 3]), 0.9, [200, 30, 30, 255]);
  }
  const closures = result.debug?.virtualClosures ?? new Float32Array(0);
  for (let i = 0; i + 3 < closures.length; i += 4) {
    drawLine(rgba, width, height, toX(closures[i]), toY(closures[i + 1]), toX(closures[i + 2]), toY(closures[i + 3]), 1.4, [20, 60, 255, 255]);
  }

  // Seeds: green = produced a room, orange = failed.
  const failedPositions = new Set(result.failedSeeds.map((failure) => `${failure.seed.x.toFixed(2)},${failure.seed.y.toFixed(2)}`));
  if (scene.textContent) {
    for (const item of scene.textContent) {
      const x = (item.minX + item.maxX) / 2;
      const y = (item.minY + item.maxY) / 2;
      const failed = failedPositions.has(`${x.toFixed(2)},${y.toFixed(2)}`);
      drawDot(rgba, width, height, toX(x), toY(y), 2.2, failed ? [255, 140, 0, 255] : [0, 150, 0, 255]);
    }
  }

  // Ground-truth polygons as black outlines.
  if (groundTruth) {
    for (const room of groundTruth.rooms) {
      const polygon = room.polygon;
      for (let i = 0; i + 1 < polygon.length; i += 2) {
        const j = (i + 2) % polygon.length;
        drawLine(rgba, width, height, toX(polygon[i]), toY(polygon[i + 1]), toX(polygon[j]), toY(polygon[j + 1]), 0.8, [0, 0, 0, 230]);
      }
    }
  }

  await fs.writeFile(imagePath, encodePng(width, height, rgba));
}

// Region map visualization: exterior = light blue, failed regions = orange, rooms =
// green, walls/strokes = dark gray, unassigned free space = white.
async function renderRegionsPng(result, imagePath) {
  const regionDebug = result.debug?.regionDebug?.get(0);
  if (!regionDebug) {
    return;
  }
  const { width, height, regionMap, exteriorRegionId, regionStatus } = regionDebug;
  const maxSize = 2200;
  const downScale = Math.max(1, Math.ceil(Math.max(width, height) / maxSize));
  const outWidth = Math.ceil(width / downScale);
  const outHeight = Math.ceil(height / downScale);
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4).fill(255);

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const sourceIndex = Math.min(height - 1, y * downScale) * width + Math.min(width - 1, x * downScale);
      const id = regionMap[sourceIndex];
      let color = null;
      if (id === exteriorRegionId) {
        color = [185, 215, 245];
      } else if (id > 0) {
        color = regionStatus[id] === 1 ? [150, 215, 150] : [245, 185, 120];
      }
      const outIndex = (y * outWidth + x) * 4;
      if (color) {
        rgba[outIndex] = color[0];
        rgba[outIndex + 1] = color[1];
        rgba[outIndex + 2] = color[2];
      }
    }
  }

  await fs.writeFile(imagePath, encodePng(outWidth, outHeight, rgba));
}

function blendPixel(rgba, width, height, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  const index = (y * width + x) * 4;
  const alpha = color[3] / 255;
  rgba[index] = rgba[index] * (1 - alpha) + color[0] * alpha;
  rgba[index + 1] = rgba[index + 1] * (1 - alpha) + color[1] * alpha;
  rgba[index + 2] = rgba[index + 2] * (1 - alpha) + color[2] * alpha;
}

function drawLine(rgba, width, height, x0, y0, x1, y1, radius, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(length / Math.max(0.4, radius * 0.5)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    drawDot(rgba, width, height, x0 + dx * t, y0 + dy * t, radius, color);
  }
}

function drawDot(rgba, width, height, cx, cy, radius, color) {
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y += 1) {
    const dy = y + 0.5 - cy;
    const halfSpan = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    const minX = Math.max(0, Math.floor(cx - halfSpan));
    const maxX = Math.min(width - 1, Math.ceil(cx + halfSpan));
    for (let x = minX; x <= maxX; x += 1) {
      blendPixel(rgba, width, height, x, y, color);
    }
  }
}

function fillPolygon(rgba, width, height, points, color) {
  if (points.length < 3) {
    return;
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(height - 1, Math.ceil(maxY)); y += 1) {
    const sampleY = y + 0.5;
    const crossings = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if (y0 <= sampleY === y1 <= sampleY) {
        continue;
      }
      crossings.push(x0 + ((sampleY - y0) / (y1 - y0)) * (x1 - x0));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const startX = Math.max(0, Math.round(crossings[i]));
      const endX = Math.min(width - 1, Math.round(crossings[i + 1]));
      for (let x = startX; x <= endX; x += 1) {
        blendPixel(rgba, width, height, x, y, color);
      }
    }
  }
}

// Minimal PNG encoder (8-bit RGBA, no filtering).
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

let crcTable = null;

function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

await main();
