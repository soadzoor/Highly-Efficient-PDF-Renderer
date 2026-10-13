/**
 * Raster sections encoded before a HEP is written. A streaming PDF export
 * encodes each page's larger images once that page is parsed and releases
 * their pixels; the layer keeps a unique empty placeholder as its `data`, and
 * this registry maps that placeholder to the section the writer stores.
 */
export interface PreparedRasterSection {
  readonly storage: "png" | "webp" | "binary" | "mono";
  readonly bytes: Uint8Array;
}

const preparedSections = new WeakMap<Uint8Array, PreparedRasterSection>();

/** A new placeholder for a layer whose pixels `section` now stores. */
export function preparedRasterPlaceholder(section: PreparedRasterSection): Uint8Array {
  const placeholder = new Uint8Array(0);
  preparedSections.set(placeholder, section);
  return placeholder;
}

/** The prepared section a layer's placeholder `data` stands for, if any. */
export function preparedRasterSection(data: unknown): PreparedRasterSection | undefined {
  return data instanceof Uint8Array ? preparedSections.get(data) : undefined;
}
