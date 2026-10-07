import * as THREE from "three";
import { buildMonochromeMipChain, monochromeCoverageTilePixels, monochromeRasterTile,
  type MonochromeRaster } from "./monochromeRaster";
import { rasterTilePixels, type RasterTilePlan } from "./rasterTiles";
import { estimateRasterTextureBytes } from "./rasterMemoryBudget";
import type { RasterCompressionFormat } from "./rasterCompression";

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
  format?: RasterCompressionFormat | null): THREE.Texture[] {
  const mono = source.monochrome;
  const packed = !!mono && plan.width === source.width && plan.height === source.height;
  const pixels = packed ? [] : mono ? monochromeCoverageTilePixels(mono, source.width, source.height, plan)
    : rasterTilePixels(source, plan);
  const textures: THREE.Texture[] = [];
  try {
    for (const [index, tile] of plan.tiles.entries()) {
      let texture: THREE.Texture;
      if (packed) {
        const bits = monochromeRasterTile(mono!, source.width, source.height, tile);
        texture = dataTexture(bits.data, Math.ceil(tile.width / 8), tile.height, true);
        texture.minFilter = texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        const chain = buildMonochromeMipChain(bits, tile.width, tile.height);
        const first = chain[0] ?? { width: 1, height: 1, data: Uint8Array.of((bits.data[0] >> 7) * 255) };
        const coverage = dataTexture(first.data, first.width, first.height, true);
        coverage.generateMipmaps = false;
        // Three's DataTexture mip array includes its base level on both backends.
        coverage.mipmaps = chain.length ? chain : [first];
        texture.addEventListener("dispose", () => coverage.dispose());
        information.set(texture, monoInfo(bits, coverage, tile.width, tile.height, 1));
      } else if (mono) {
        texture = dataTexture(pixels[index], tile.width, tile.height, true);
        information.set(texture, monoInfo(mono, texture, tile.width, tile.height, 2));
      } else if (format && compressor) {
        texture = compressor.upload(pixels[index], tile.width, tile.height, format);
      } else {
        texture = dataTexture(pixels[index], tile.width, tile.height);
        information.set(texture, { ...threeRasterTextureInfo(texture), size: new THREE.Vector2(tile.width, tile.height),
          estimatedBytes: estimateRasterTextureBytes(tile.width, tile.height, false) });
      }
      textures.push(texture);
    }
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
