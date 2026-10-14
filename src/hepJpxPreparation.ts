import type { RasterLayer } from "./pdfVectorExtractor";
import type { PreparedRasterSection } from "./preparedRasterSections";
import { encodeHepJpxRaster, inspectHepJpxRaster, HEP_JPX_RASTER_HEADER_BYTES } from "./hepJpxRaster";
import { hashSourceJpxEncoded, hashSourceJpxRgba, isSourceJpxRaster } from "./sourceJpxRaster";

/** Retain original compression only while both public pixels and codec bytes are unchanged. */
export async function prepareSourceJpxRaster(layer: RasterLayer, signal?: AbortSignal): Promise<PreparedRasterSection | null> {
  signal?.throwIfAborted();
  const source = layer.sourceJpx;
  if (!isSourceJpxRaster(source) || layer.monochrome || layer.repeat ||
      source.width !== layer.width || source.height !== layer.height ||
      !(layer.data instanceof Uint8Array) || layer.data.length !== layer.width * layer.height * 4 ||
      source.encoded.length + HEP_JPX_RASTER_HEADER_BYTES >= layer.data.length) return null;
  const encodedHash = hashSourceJpxEncoded(source.encoded, signal);
  if (encodedHash[0] !== source.encodedHash[0] || encodedHash[1] !== source.encodedHash[1]) return null;
  const rgbaHash = hashSourceJpxRgba(layer.data, layer.width, layer.height, signal);
  if (rgbaHash[0] !== source.rgbaHash[0] || rgbaHash[1] !== source.rgbaHash[1]) return null;
  let bytes: Uint8Array;
  try {
    bytes = encodeHepJpxRaster(source);
    await inspectHepJpxRaster(bytes, layer.width, layer.height, signal);
  } catch {
    signal?.throwIfAborted();
    // Stale or caller-supplied provenance never prevents an ordinary export.
    return null;
  }
  signal?.throwIfAborted();
  return { storage: "jpx", bytes };
}
