import { HEPR_IMAGE_FORMAT, type HeprImageStore } from "../heprDocumentData";
import { hashSourceJpxEncoded, hashSourceJpxGray, hashSourceJpxRgba, type SourceJpxRaster } from "../sourceJpxRaster";
import type { NativePdfImageDescription, NativePdfImageRegistry } from "./nativeImage";

interface SourceJpxBinding extends SourceJpxRaster {
  readonly format: number;
}

// Bind before public page/scene exposure. Values retain only encoded bytes and
// fingerprints, never a native record or an additional decoded pixel plane.
const nativeBindings = new WeakMap<NativePdfImageDescription, SourceJpxBinding>();
const storeBindings = new WeakMap<HeprImageStore, ReadonlyMap<number, SourceJpxBinding>>();

function bindNativeSourceJpx(image: NativePdfImageDescription, signal?: AbortSignal): SourceJpxBinding | undefined {
  signal?.throwIfAborted();
  const original = image.originalJpx;
  if (!original || image.imageMask || image.softMaskImageIndex >= 0 || image.maskKind !== "none" ||
      image.width !== original.width || image.height !== original.height ||
      !((original.components === 1 && image.format === HEPR_IMAGE_FORMAT.Gray8) ||
        (original.components === 3 && image.format === HEPR_IMAGE_FORMAT.Rgba8))) return undefined;
  let binding = nativeBindings.get(image);
  if (!binding) {
    const rgbaHash = image.format === HEPR_IMAGE_FORMAT.Gray8
      ? hashSourceJpxGray(image.data, image.width, image.height, signal)
      : hashSourceJpxRgba(image.data, image.width, image.height, signal);
    binding = { ...original, format: image.format, rgbaHash,
      encodedHash: hashSourceJpxEncoded(original.encoded, signal) };
    nativeBindings.set(image, binding);
  }
  return binding;
}

function exposeSourceJpx(binding: SourceJpxBinding, signal?: AbortSignal): SourceJpxRaster {
  signal?.throwIfAborted();
  // One copy per page/lowering, shared by its placements. Worker transfer or
  // edits to public byte/hash arrays cannot change a later replay's authority.
  const encoded = binding.encoded.slice();
  signal?.throwIfAborted();
  return { width: binding.width, height: binding.height, components: binding.components, encoded,
    rgbaHash: [binding.rgbaHash[0], binding.rgbaHash[1]],
    encodedHash: [binding.encodedHash[0], binding.encodedHash[1]] };
}

/** Internal direct-page adapter; callers cache the result across placements. */
export function sourceJpxForNativeImage(image: NativePdfImageDescription, signal?: AbortSignal): SourceJpxRaster | undefined {
  const binding = bindNativeSourceJpx(image, signal);
  return binding ? exposeSourceJpx(binding, signal) : undefined;
}

/** Register only parser-owned stores, immediately after their native bytes were copied. */
export function bindNativeSourceJpxStore(store: HeprImageStore, registry: NativePdfImageRegistry,
  signal?: AbortSignal): void {
  const bindings = new Map<number, SourceJpxBinding>();
  for (let index = 0; index < registry.size; index++) {
    const binding = bindNativeSourceJpx(registry.describe(index), signal);
    if (binding) bindings.set(index, binding);
  }
  if (bindings.size) storeBindings.set(store, bindings);
}

/** Internal retained adapter; masks/composites never inherit source samples. */
export function sourceJpxForStoreImage(store: HeprImageStore, index: number,
  signal?: AbortSignal): SourceJpxRaster | undefined {
  signal?.throwIfAborted();
  const binding = storeBindings.get(store)?.get(index);
  if (!binding || store.imageMask[index] || store.softMaskImageIndices[index] >= 0 ||
      store.widths[index] !== binding.width || store.heights[index] !== binding.height ||
      store.formats[index] !== binding.format ||
      store.colorKeyMaskOffsets[index] !== store.colorKeyMaskOffsets[index + 1] ||
      store.matteOffsets[index] !== store.matteOffsets[index + 1] ||
      store.dataOffsets[index + 1] - store.dataOffsets[index] !== binding.width * binding.height *
        (binding.format === HEPR_IMAGE_FORMAT.Gray8 ? 1 : 4)) return undefined;
  return exposeSourceJpx(binding, signal);
}
