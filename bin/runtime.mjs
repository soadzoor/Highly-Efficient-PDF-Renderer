/** Load the compiled converter without Vite or the repository source graph. */
export async function loadPublishedHepBuilder() {
  const { buildHep, HepArchive } = await import("../dist/lib/pdf-to-hep-runtime.js");
  return { buildHep, HepArchive, close: async () => {} };
}
