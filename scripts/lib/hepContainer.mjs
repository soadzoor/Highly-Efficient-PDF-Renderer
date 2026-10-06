import { registerHooks } from "node:module";

// Direct source tests need TypeScript resolution before the container's shared
// modules are linked, and while its optional writer loads later in the test.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

export const {
  HepArchive,
  HepArchiveEntry,
  crc32,
  hasHepSignature,
  hasLegacyZipSignature,
  encodeFloat32Palette,
  decodeFloat32Palette
} = await import("../../src/hepContainer.ts");
