import type { HepLodOptions } from "./hepLod";

/** Include both LOD caches by default while preserving explicit opt-outs. */
export function resolveHepLodOptions<T extends HepLodOptions>(
  options: T
): Omit<T, "withVectorLod" | "withTextLod"> & { withVectorLod: boolean; withTextLod: boolean } {
  return {
    ...options,
    withVectorLod: options.withVectorLod ?? true,
    withTextLod: options.withTextLod ?? true
  };
}
