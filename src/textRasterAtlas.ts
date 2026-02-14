import type { VectorScene } from "./pdfVectorExtractor";

export interface TextRasterAtlas {
  width: number;
  height: number;
  rgba: Uint8Array;
  glyphUvRects: Float32Array;
}

interface GlyphPlacement {
  index: number;
  segmentStart: number;
  segmentCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  innerWidth: number;
  innerHeight: number;
  tileWidth: number;
  tileHeight: number;
  x: number;
  y: number;
}

const GLYPH_TARGET_MAX_DIM_PX = 96;
const GLYPH_TARGET_MAX_DIM_FALLBACK = [1, 0.85, 0.7, 0.55, 0.4, 0.3];
const GLYPH_MIN_DIM_PX = 8;
const GLYPH_MAX_DIM_PX = 256;
const GLYPH_PADDING_PX = 2;
const CONNECTION_EPSILON = 1e-3;

export function buildTextRasterAtlas(scene: VectorScene, maxTextureSize: number): TextRasterAtlas | null {
  if (typeof document === "undefined" || scene.textGlyphCount <= 0) {
    return null;
  }

  const glyphUvRects = new Float32Array(scene.textGlyphCount * 4);
  const atlasSizeLimit = clamp(Math.trunc(maxTextureSize) || 4096, 256, 8192);

  let selected: { placements: GlyphPlacement[]; width: number; height: number } | null = null;

  for (const qualityScale of GLYPH_TARGET_MAX_DIM_FALLBACK) {
    const targetMaxDim = Math.max(GLYPH_MIN_DIM_PX, Math.round(GLYPH_TARGET_MAX_DIM_PX * qualityScale));
    const placements = buildPlacements(scene, targetMaxDim);
    if (placements.length === 0) {
      return null;
    }

    const packed = packPlacements(placements, atlasSizeLimit);
    if (!packed) {
      continue;
    }

    selected = packed;
    break;
  }

  if (!selected) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = selected.width;
  canvas.height = selected.height;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) {
    return null;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, selected.width, selected.height);
  context.fillStyle = "#ffffff";
  context.globalCompositeOperation = "source-over";

  for (const placement of selected.placements) {
    if (!drawGlyphPlacementPath(context, placement, scene)) {
      continue;
    }
    context.fill("nonzero");

    const offset = placement.index * 4;
    glyphUvRects[offset] = (placement.x + GLYPH_PADDING_PX) / selected.width;
    glyphUvRects[offset + 1] = (placement.y + GLYPH_PADDING_PX) / selected.height;
    glyphUvRects[offset + 2] = placement.innerWidth / selected.width;
    glyphUvRects[offset + 3] = placement.innerHeight / selected.height;
  }

  const imageData = context.getImageData(0, 0, selected.width, selected.height);
  const rgba = new Uint8Array(imageData.data);

  return {
    width: selected.width,
    height: selected.height,
    rgba,
    glyphUvRects
  };
}

function buildPlacements(scene: VectorScene, targetMaxDim: number): GlyphPlacement[] {
  const placements: GlyphPlacement[] = [];

  for (let glyphIndex = 0; glyphIndex < scene.textGlyphCount; glyphIndex += 1) {
    const glyphOffset = glyphIndex * 4;
    const segmentStart = Math.max(0, Math.trunc(scene.textGlyphMetaA[glyphOffset]));
    const segmentCount = Math.max(0, Math.trunc(scene.textGlyphMetaA[glyphOffset + 1]));
    if (segmentCount <= 0) {
      continue;
    }

    const minX = scene.textGlyphMetaA[glyphOffset + 2];
    const minY = scene.textGlyphMetaA[glyphOffset + 3];
    const maxX = scene.textGlyphMetaB[glyphOffset];
    const maxY = scene.textGlyphMetaB[glyphOffset + 1];
    const width = maxX - minX;
    const height = maxY - minY;

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1e-6 || height <= 1e-6) {
      continue;
    }

    const scale = targetMaxDim / Math.max(width, height);
    const innerWidth = clamp(Math.ceil(width * scale), GLYPH_MIN_DIM_PX, GLYPH_MAX_DIM_PX);
    const innerHeight = clamp(Math.ceil(height * scale), GLYPH_MIN_DIM_PX, GLYPH_MAX_DIM_PX);
    placements.push({
      index: glyphIndex,
      segmentStart,
      segmentCount,
      minX,
      minY,
      maxX,
      maxY,
      innerWidth,
      innerHeight,
      tileWidth: innerWidth + GLYPH_PADDING_PX * 2,
      tileHeight: innerHeight + GLYPH_PADDING_PX * 2,
      x: 0,
      y: 0
    });
  }

  return placements;
}

function packPlacements(
  placements: GlyphPlacement[],
  maxSize: number
): { placements: GlyphPlacement[]; width: number; height: number } | null {
  if (placements.length === 0) {
    return null;
  }

  const sorted = placements.slice().sort((a, b) => {
    if (a.tileHeight !== b.tileHeight) {
      return b.tileHeight - a.tileHeight;
    }
    return b.tileWidth - a.tileWidth;
  });

  const totalArea = sorted.reduce((sum, glyph) => sum + glyph.tileWidth * glyph.tileHeight, 0);
  const largestTileWidth = sorted.reduce((max, glyph) => Math.max(max, glyph.tileWidth), 0);
  let atlasWidth = clamp(roundUpToPowerOfTwo(Math.ceil(Math.sqrt(totalArea) * 1.15)), largestTileWidth, maxSize);

  while (atlasWidth <= maxSize) {
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let failed = false;

    for (const placement of sorted) {
      if (placement.tileWidth > atlasWidth) {
        failed = true;
        break;
      }
      if (x + placement.tileWidth > atlasWidth) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }

      placement.x = x;
      placement.y = y;
      x += placement.tileWidth;
      rowHeight = Math.max(rowHeight, placement.tileHeight);

      if (y + rowHeight > maxSize) {
        failed = true;
        break;
      }
    }

    if (!failed) {
      const usedHeight = y + rowHeight;
      const atlasHeight = clamp(roundUpToPowerOfTwo(Math.max(usedHeight, 1)), 1, maxSize);
      if (atlasHeight <= maxSize) {
        return { placements: sorted, width: atlasWidth, height: atlasHeight };
      }
    }

    if (atlasWidth === maxSize) {
      break;
    }
    atlasWidth = Math.min(maxSize, atlasWidth * 2);
  }

  return null;
}

function drawGlyphPlacementPath(
  context: CanvasRenderingContext2D,
  placement: GlyphPlacement,
  scene: VectorScene
): boolean {
  const width = Math.max(placement.maxX - placement.minX, 1e-6);
  const height = Math.max(placement.maxY - placement.minY, 1e-6);
  const scaleX = placement.innerWidth / width;
  const scaleY = placement.innerHeight / height;
  const offsetX = placement.x + GLYPH_PADDING_PX - placement.minX * scaleX;
  const offsetY = placement.y + GLYPH_PADDING_PX + placement.maxY * scaleY;

  const mapX = (x: number): number => offsetX + x * scaleX;
  const mapY = (y: number): number => offsetY - y * scaleY;

  context.beginPath();
  let hasAnySegments = false;
  let subpathOpen = false;
  let subpathStartX = 0;
  let subpathStartY = 0;
  let cursorX = 0;
  let cursorY = 0;

  for (let i = 0; i < placement.segmentCount; i += 1) {
    const segmentIndex = placement.segmentStart + i;
    const segmentOffset = segmentIndex * 4;
    if (segmentOffset + 3 >= scene.textGlyphSegmentsA.length || segmentOffset + 3 >= scene.textGlyphSegmentsB.length) {
      break;
    }

    const p0x = scene.textGlyphSegmentsA[segmentOffset];
    const p0y = scene.textGlyphSegmentsA[segmentOffset + 1];
    const cx = scene.textGlyphSegmentsA[segmentOffset + 2];
    const cy = scene.textGlyphSegmentsA[segmentOffset + 3];
    const p2x = scene.textGlyphSegmentsB[segmentOffset];
    const p2y = scene.textGlyphSegmentsB[segmentOffset + 1];
    const primitiveType = scene.textGlyphSegmentsB[segmentOffset + 2];

    const needsMoveTo = !subpathOpen || !pointsClose(p0x, p0y, cursorX, cursorY);
    if (needsMoveTo) {
      if (subpathOpen) {
        context.closePath();
      }
      context.moveTo(mapX(p0x), mapY(p0y));
      subpathOpen = true;
      subpathStartX = p0x;
      subpathStartY = p0y;
    }

    if (primitiveType >= 0.5) {
      context.quadraticCurveTo(mapX(cx), mapY(cy), mapX(p2x), mapY(p2y));
    } else {
      context.lineTo(mapX(p2x), mapY(p2y));
    }

    hasAnySegments = true;
    cursorX = p2x;
    cursorY = p2y;

    if (pointsClose(cursorX, cursorY, subpathStartX, subpathStartY)) {
      context.closePath();
      subpathOpen = false;
    }
  }

  if (subpathOpen) {
    context.closePath();
  }

  return hasAnySegments;
}

function pointsClose(x0: number, y0: number, x1: number, y1: number): boolean {
  return Math.abs(x0 - x1) <= CONNECTION_EPSILON && Math.abs(y0 - y1) <= CONNECTION_EPSILON;
}

function roundUpToPowerOfTwo(value: number): number {
  if (value <= 1) {
    return 1;
  }
  let out = 1;
  while (out < value) {
    out <<= 1;
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

