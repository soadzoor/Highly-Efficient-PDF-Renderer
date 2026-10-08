import { buildCompactMonochromeAtlas } from "./compactMonochromeRaster";
import * as THREE from "three";
import { buildPackedMonochromeMipAtlas, monochromeCoverageTilePixels, monochromeRasterTile,
  type MonochromeRaster } from "./monochromeRaster";
import { rasterTilePixels, type RasterTilePlan } from "./rasterTiles";
import { rememberMonochromePlanBytes, estimateRasterTextureBytes } from "./rasterMemoryBudget";
import type { RasterCompressionFormat } from "./rasterCompression";
import type { PreparedRasterPixels } from "./rasterPreparation";
import { sameRasterTilePlan } from "./rasterTiles";
import { buildPackedCoverageMipAtlas } from "./packedMonochromeCoverage";

export interface ThreeRasterTextureInfo {
  mode: number;
  coverage: THREE.Texture;
  size: THREE.Vector2;
  color0: THREE.Vector4;
  color1: THREE.Vector4;
  estimatedBytes: number;
  compressionFormat?: RasterCompressionFormat;
  uvScale: readonly [number, number];
}

export interface ThreeRasterCompressor {
  readonly format: RasterCompressionFormat | null;
  upload(data: Uint8Array, width: number, height: number, format: RasterCompressionFormat): THREE.Texture;
}

const information = new WeakMap<THREE.Texture, ThreeRasterTextureInfo>();

export function threeRasterTextureInfo(texture: THREE.Texture): ThreeRasterTextureInfo {
  return information.get(texture) ?? { mode: 0, coverage: texture, size: new THREE.Vector2(1, 1),
    color0: new THREE.Vector4(), color1: new THREE.Vector4(), estimatedBytes: 0, uvScale: [1, 1] };
}

export function registerThreeCompressedTexture(texture: THREE.Texture, width: number, height: number,
  format: RasterCompressionFormat, estimatedBytes: number, uvScale: readonly [number, number]): void {
  information.set(texture, { ...threeRasterTextureInfo(texture), size: new THREE.Vector2(width, height),
    estimatedBytes, compressionFormat: format, uvScale });
}

export function markThreeRasterTextureForUpload(texture: THREE.Texture): void {
  texture.needsUpdate = true;
  const coverage = threeRasterTextureInfo(texture).coverage;
  if (coverage !== texture) coverage.needsUpdate = true;
}

/** Display derivatives preserve packed canonical pixels and never invoke their RGBA getter. */
export function createThreeRasterTileTextures(source: { width: number; height: number; data: Uint8Array;
  monochrome?: MonochromeRaster }, plan: RasterTilePlan, compressor?: ThreeRasterCompressor,
  format?: RasterCompressionFormat | null, prepared?: PreparedRasterPixels): THREE.Texture[] {
  if (prepared && !sameRasterTilePlan(prepared.plan, plan)) prepared = undefined;
  const mono = source.monochrome;
  const packed = !!mono && plan.width === source.width && plan.height === source.height;
  const pixels = prepared?.pixels ?? (packed ? [] : mono ? monochromeCoverageTilePixels(mono, source.width, source.height, plan)
    : rasterTilePixels(source, plan));
  const textures: THREE.Texture[] = [];
  try {
    for (const [index, tile] of plan.tiles.entries()) {
      let texture: THREE.Texture;
      if (mono) {
        const bits = packed ? prepared?.monochromeTiles?.[index] ?? monochromeRasterTile(mono, source.width, source.height, tile) : mono;
        const atlas = prepared?.coverageAtlases?.[index] ?? (packed ? buildPackedMonochromeMipAtlas(bits, tile.width, tile.height)
          : buildPackedCoverageMipAtlas(pixels[index], tile.width, tile.height));
        const compact = prepared?.compactAtlases ? prepared.compactAtlases[index]
          : buildCompactMonochromeAtlas(bits, tile.width, tile.height, atlas, packed ? undefined : pixels[index]);
        if (compact) {
          texture = dataTexture(compact.data, compact.width, compact.height);
          texture.generateMipmaps = false;
          texture.minFilter = THREE.LinearFilter;
          information.set(texture, { ...monoInfo(bits, texture, tile.width, tile.height, 3), estimatedBytes: compact.data.length });
        } else {
          texture = dataTexture(packed ? bits.data : pixels[index], packed ? Math.ceil(tile.width / 8) : tile.width, tile.height, true);
          texture.minFilter = texture.magFilter = packed ? THREE.NearestFilter : THREE.LinearFilter;
          texture.generateMipmaps = false;
          const coverage = dataTexture(atlas.data, atlas.width, atlas.height, true);
          coverage.generateMipmaps = false;
          coverage.minFilter = THREE.LinearFilter;
          texture.addEventListener("dispose", () => coverage.dispose());
          information.set(texture, monoInfo(bits, coverage, tile.width, tile.height, packed ? 1 : 2));
        }
      } else if (format && compressor) {
        texture = compressor.upload(pixels[index], tile.width, tile.height, format);
      } else {
        texture = dataTexture(pixels[index], tile.width, tile.height);
        information.set(texture, { ...threeRasterTextureInfo(texture), size: new THREE.Vector2(tile.width, tile.height),
          estimatedBytes: estimateRasterTextureBytes(tile.width, tile.height, false) });
      }
      textures.push(texture);
    }
    if (mono) rememberMonochromePlanBytes(source, plan, textures.reduce((sum, texture) => sum + threeRasterTextureInfo(texture).estimatedBytes, 0));
    return textures;
  } catch (error) {
    for (const texture of textures) texture.dispose();
    throw error;
  }
}

function monoInfo(mono: MonochromeRaster, coverage: THREE.Texture,
  width: number, height: number, mode: number): ThreeRasterTextureInfo {
  const color = (offset: number) => {
    const alpha = mono.colors[offset + 3] / 255;
    return new THREE.Vector4(mono.colors[offset] / 255 * alpha, mono.colors[offset + 1] / 255 * alpha,
      mono.colors[offset + 2] / 255 * alpha, alpha);
  };
  return { mode, coverage, size: new THREE.Vector2(width, height), color0: color(0), color1: color(4),
    estimatedBytes: estimateRasterTextureBytes(width, height, mode === 1, null, mode === 2), uvScale: [1, 1] };
}

function dataTexture(data: Uint8Array, width: number, height: number, singleChannel = false): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, singleChannel ? THREE.RedFormat : THREE.RGBAFormat,
    THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
