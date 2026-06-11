/**
 * Headless room-detection debug harness.
 *
 * Loads example floorplan PDFs through the real extractor in Node (via Vite SSR module
 * loading), runs detectRooms, prints per-page statistics, and renders the detection
 * result (walls, closures, rooms, seeds) into PNG snapshots under .debug/.
 *
 * Usage:
 *   node scripts/room-detect-debug.mjs "LK Office Level 1.pdf" [more.pdf ...]
 *   node scripts/room-detect-debug.mjs --all   # the four reference floorplans
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import zlib from "node:zlib";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const pdfDir = path.resolve(repoRootDir, "public", "examples", "pdfs");
const outDir = path.resolve(repoRootDir, ".debug");

const REFERENCE_PDFS = [
  "LK Office Level 1.pdf",
  "SimiValleyBehavioralHealth_SR_20180403.pdf",
  "Dublin 1st Floor 2018 06 01.pdf",
  "Murietta_Level1.pdf"
];

const IMAGE_MAX_SIZE = 2200;

async function main() {
  const args = process.argv.slice(2);
  const names = args.includes("--all") ? REFERENCE_PDFS : args.filter((arg) => !arg.startsWith("--"));
  if (names.length === 0) {
    console.error("Usage: node scripts/room-detect-debug.mjs <pdf name in public/examples/pdfs> | --all");
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

    for (const name of names) {
      const filePath = path.resolve(pdfDir, name);
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
      const result = detector.detectRooms(scene, { collectDebugInfo: true });
      const detectMs = performance.now() - detectStart;

      printResult(result, detectMs);
      const stem = path.parse(name).name.replaceAll(" ", "_");
      const imagePath = path.resolve(outDir, `${stem}.png`);
      await renderResultPng(scene, result, imagePath);
      const regionsPath = path.resolve(outDir, `${stem}_regions.png`);
      await renderRegionsPng(result, regionsPath);
      console.log(`wrote ${path.relative(repoRootDir, imagePath)} and ${path.relative(repoRootDir, regionsPath)}`);
    }
  } finally {
    await server.close();
  }
}

function printResult(result, detectMs) {
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
  for (const [index, room] of result.rooms.entries()) {
    const label = room.labelText.replaceAll("\n", " | ");
    console.log(`  room ${index}: area=${room.area.toFixed(0)} vertices=${room.polygon.length / 2} label="${label}"`);
  }
}

// ---------------------------------------------------------------------------
// PNG rendering
// ---------------------------------------------------------------------------

async function renderResultPng(scene, result, imagePath) {
  const bounds = scene.pageBounds;
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
