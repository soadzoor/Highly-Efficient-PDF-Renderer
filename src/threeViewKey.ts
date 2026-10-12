import type { Camera } from "three";
import type { HeprThreePdfObject } from "./threePdfObject";

/**
 * A key that changes whenever picks against a Three PDF object may change:
 * the entire camera projection, the object and page transforms (covering
 * orthographic/perspective changes and nonuniform parent transforms), and
 * layer visibility. Hosts compare it every frame.
 */
export function createThreeViewKey(getCamera: () => Camera, getPdfObject: () => HeprThreePdfObject | null): () => string {
  // Page world matrices as of the last page scan, compared in place instead of
  // stringifying every page of a book each frame.
  let pageMatrices = new Float64Array(0), pageCount = 0, pageRevision = 0, viewKey = "";
  function pageLayoutRevision(pdf: HeprThreePdfObject | null): number {
    const pages = pdf?.children ?? [];
    let changed = false, count = 0;
    if (pageMatrices.length < pages.length * 16) { pageMatrices = new Float64Array(pages.length * 16); changed = true; }
    for (const page of pages) {
      if (!page.userData.hepr) continue;
      page.updateWorldMatrix(false, false);
      const elements = page.matrixWorld.elements, offset = count++ * 16;
      for (let i = 0; i < 16; i++) {
        if (pageMatrices[offset + i] !== elements[i]) { pageMatrices[offset + i] = elements[i]; changed = true; }
      }
    }
    if (count !== pageCount) { pageCount = count; changed = true; }
    if (changed) pageRevision++;
    return pageRevision;
  }
  return () => {
    const camera = getCamera(), pdf = getPdfObject();
    camera.updateWorldMatrix(true, false); pdf?.updateWorldMatrix(true, false);
    const view = `${camera.projectionMatrix.elements.join(",")}:${camera.matrixWorld.elements.join(",")}:` +
      `${pdf?.matrixWorld.elements.join(",") ?? ""}:${pdf?.layerVisibilityRevision ?? 0}`;
    // A moving camera already changes the key, so scrolling skips the page
    // scan. The next still frame compares pages against the last scan, which
    // still reports any page moved in between, unless it moved back exactly.
    const pages = view === viewKey ? pageLayoutRevision(pdf) : pageRevision;
    viewKey = view;
    return `${view}:${pages}`;
  };
}
