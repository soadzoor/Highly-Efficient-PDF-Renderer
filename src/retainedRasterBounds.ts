import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { ScenePaintNode } from "./scenePaintGraph";

const caches = new WeakMap<VectorScene, ReadonlyMap<number, Bounds>>();

/** A replay slot can move beyond its current cropped image when layers change. */
export function retainedRasterBounds(scene: VectorScene, rasterIndex: number): Bounds | undefined {
  if (!scene.retainedPages?.length || !scene.paintGraph) return undefined;
  let bounds = caches.get(scene);
  if (!bounds) {
    const result = new Map<number, Bounds>();
    const visit = (nodes: readonly ScenePaintNode[]): void => {
      for (const node of nodes) {
        if (node.kind === "group") {
          visit(node.children);
          if (node.softMask) visit(node.softMask.children);
        } else if (node.kind === "retained") {
          const resource = scene.retainedPages![node.retainedPage];
          const { width, height } = resource.page.pageInfo, m = resource.matrix;
          const box = result.get(node.rasterIndex) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
          for (const x of [0, width]) for (const y of [0, height]) {
            const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5];
            box.minX = Math.min(box.minX, px); box.minY = Math.min(box.minY, py);
            box.maxX = Math.max(box.maxX, px); box.maxY = Math.max(box.maxY, py);
          }
          result.set(node.rasterIndex, box);
        }
      }
    };
    visit(scene.paintGraph.roots);
    caches.set(scene, bounds = result);
  }
  return bounds.get(rasterIndex);
}
