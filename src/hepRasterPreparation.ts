import type { RasterLayer, VectorScene } from "./pdfVectorExtractor";
import { encodeHepBinaryRaster } from "./hepBinaryRaster";
import { encodeHepMonochromeRaster } from "./hepMonochromeRaster";
import { isRasterAtlasCandidate } from "./hepRasterLayers";
import { detectMonochromeRaster } from "./monochromeRaster";
import { preparedRasterPlaceholder, type PreparedRasterSection } from "./preparedRasterSections";
import { encodeRasterRgbaCandidates, pickBestRasterImage } from "./rasterImageCodec";

/** Encodes one parsed page's larger images before the next page is decoded. */
export type HepRasterPagePreparer = (scene: VectorScene, signal?: AbortSignal) => Promise<void>;

/**
 * A streaming PDF export keeps every page until the HEP is written, but only
 * needs the encoded form of its larger images. This preparer stores each such
 * image the way the HEP writer would (exact two-color packing, otherwise the
 * smaller of WebP and PNG) as soon as its page is parsed, and releases its
 * pixels. Identical images across the document, matched by a SHA-256 digest
 * of their pixels, share one encoded section. Atlas-sized images keep their
 * pixels so the writer still packs them document-wide.
 */
export function createHepRasterPagePreparer(): HepRasterPagePreparer {
  const sectionsByDigest = new Map<string, PreparedRasterSection>();
  return async (scene, signal) => {
    let replaced = false;
    for (let index = 0; index < scene.rasterLayers.length; index += 1) {
      signal?.throwIfAborted();
      const layer = scene.rasterLayers[index];
      if (!isPreparableRasterLayer(layer)) continue;
      const { width, height } = layer;
      const rgba = layer.data.subarray(0, width * height * 4);
      const digest = await pixelDigest(rgba, width, height);
      signal?.throwIfAborted();
      let section = digest === undefined ? undefined : sectionsByDigest.get(digest);
      if (!section) {
        const encoded = await encodeRasterSection(width, height, rgba, signal);
        // Nothing beats raw pixels; the writer stores them as it always has.
        if (!encoded) continue;
        section = encoded;
        if (digest !== undefined) sectionsByDigest.set(digest, section);
      }
      scene.rasterLayers[index] = { ...layer, data: preparedRasterPlaceholder(section) };
      replaced = true;
    }
    // A page's legacy first-raster accessor would otherwise retain its pixels.
    if (replaced) {
      Object.defineProperty(scene, "rasterLayerData", {
        configurable: true,
        enumerable: true,
        get: () => scene.rasterLayers[0]?.data ?? new Uint8Array(0)
      });
    }
  };
}

function isPreparableRasterLayer(layer: RasterLayer): boolean {
  const { width, height } = layer;
  return !layer.monochrome && !layer.repeat && !layer.gpuCompression && !layer.gpuPreparation &&
    !layer.pageDemandSlot && layer.compressionHint === undefined &&
    Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
    Number.isSafeInteger(width * height * 4) && Object.getOwnPropertyDescriptor(layer, "data")?.value instanceof Uint8Array &&
    layer.data.length >= width * height * 4 && !isRasterAtlasCandidate(width, height);
}

/** The section the HEP writer would store for these pixels, or null for raw RGBA. */
async function encodeRasterSection(
  width: number,
  height: number,
  rgba: Uint8Array,
  signal?: AbortSignal
): Promise<PreparedRasterSection | null> {
  const monochrome = detectMonochromeRaster(rgba, width, height);
  if (monochrome) {
    const packedRuns = encodeHepBinaryRaster(monochrome, width, height, signal);
    return packedRuns ? { storage: "binary", bytes: packedRuns }
      : { storage: "mono", bytes: encodeHepMonochromeRaster(monochrome, width, height, signal) };
  }
  const image = pickBestRasterImage(width, height, await encodeRasterRgbaCandidates(width, height, rgba));
  signal?.throwIfAborted();
  return image ? { storage: image.encoding, bytes: image.bytes } : null;
}

/**
 * Dimensions and SHA-256 of the pixels, or undefined without WebCrypto (for
 * example on an insecure origin); identical images are then encoded twice.
 */
async function pixelDigest(rgba: Uint8Array, width: number, height: number): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const view = rgba.buffer instanceof ArrayBuffer
    ? new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength) : new Uint8Array(rgba);
  const digest = new Uint8Array(await subtle.digest("SHA-256", view as Uint8Array<ArrayBuffer>));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return `${width}x${height}:${hex}`;
}
