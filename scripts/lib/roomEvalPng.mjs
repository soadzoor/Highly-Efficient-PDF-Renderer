// PNG rendering helpers for the room-detection eval harness (scripts/eval-rooms.mjs).
//
// Renders the detection result (all strokes, wall candidates, virtual closures, room
// polygons, seeds, optional ground-truth outlines) plus the raw flood-fill region map
// into standalone PNGs with a minimal zlib-based encoder — no native canvas needed.

import zlib from "node:zlib";

const IMAGE_MAX_SIZE = 2200;

const ROOM_PALETTE = [
  [230, 70, 70],
  [60, 140, 230],
  [70, 180, 90],
  [230, 150, 50],
  [160, 90, 220],
  [40, 180, 190],
  [220, 90, 170],
  [150, 160, 40]
];

/**
 * Annotated overlay: strokes light gray, detected walls red, closures blue, rooms
 * palette-filled, seeds green/orange, ground-truth polygons black outlines.
 *
 * `groundTruth` is optional: { rooms: [{ roomNumber, polygon: number[] (flat x,y scene coords) }] }.
 */
export function renderResultPng(scene, result, groundTruth = null) {
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

  // All strokes, light gray. Scene encoding stores (start, control-or-line-end) in
  // `endpoints` and the true end point plus primitive type in `primitiveMeta`.
  const endpoints = scene.endpoints;
  const primitiveMeta = scene.primitiveMeta;
  for (let i = 0; i < scene.segmentCount; i += 1) {
    const base = i * 4;
    const x0 = endpoints[base];
    const y0 = endpoints[base + 1];
    const controlOrEndX = endpoints[base + 2];
    const controlOrEndY = endpoints[base + 3];
    const isQuadratic = (primitiveMeta[base + 2] ?? 0) >= 0.5;
    if (!isQuadratic) {
      drawLine(rgba, width, height, toX(x0), toY(y0), toX(controlOrEndX), toY(controlOrEndY), 0.6, [185, 185, 185, 255]);
      continue;
    }
    const x1 = primitiveMeta[base];
    const y1 = primitiveMeta[base + 1];
    let previousX = x0;
    let previousY = y0;
    for (let step = 1; step <= 8; step += 1) {
      const t = step / 8;
      const mt = 1 - t;
      const nextX = mt * mt * x0 + 2 * mt * t * controlOrEndX + t * t * x1;
      const nextY = mt * mt * y0 + 2 * mt * t * controlOrEndY + t * t * y1;
      drawLine(rgba, width, height, toX(previousX), toY(previousY), toX(nextX), toY(nextY), 0.6, [185, 185, 185, 255]);
      previousX = nextX;
      previousY = nextY;
    }
  }

  for (const [index, room] of result.rooms.entries()) {
    const color = ROOM_PALETTE[index % ROOM_PALETTE.length];
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

  if (groundTruth) {
    for (const room of groundTruth.rooms) {
      const polygon = room.polygon;
      for (let i = 0; i + 1 < polygon.length; i += 2) {
        const j = (i + 2) % polygon.length;
        drawLine(rgba, width, height, toX(polygon[i]), toY(polygon[i + 1]), toX(polygon[j]), toY(polygon[j + 1]), 0.8, [0, 0, 0, 230]);
      }
    }
  }

  return encodePng(width, height, rgba);
}

/**
 * Region map visualization: exterior = light blue, failed regions = orange, rooms =
 * green, walls/strokes = dark gray via background, unassigned free space = white.
 * Returns null when the result carries no region debug payload.
 */
export function renderRegionsPng(result, pageIndex = 0) {
  const regionDebug = result.debug?.regionDebug?.get(pageIndex);
  if (!regionDebug) {
    return null;
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

  return encodePng(outWidth, outHeight, rgba);
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
export function encodePng(width, height, rgba) {
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
