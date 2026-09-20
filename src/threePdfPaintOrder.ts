import { vectorDrawRunRenderOrder } from "./threeVectorDrawRuns";
import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import {
  HEPR_THREE_LAYER_ORDER_FILL,
  HEPR_THREE_LAYER_ORDER_RASTER
} from "./threeLayerOrder";

export interface ThreePdfOrderedPaintMesh {
  mesh: THREE.Object3D;
  pageIndex: number;
  paintOrder: number;
  /** Source primitive this mesh paints; the gradient layer skips empty runs. */
  primitiveKind?: "gradient-fill" | "gradient-stroke";
  primitiveIndex?: number;
}

interface OrderedRasterLayer {
  width?: number;
  height?: number;
  data?: unknown;
  paintOrder?: number;
  pageIndex?: number;
}

interface RasterPaintMesh {
  mesh: THREE.Object3D;
  count: number;
}

/**
 * Interleave sparse native gradient paints with extracted image layers while
 * keeping the complete group below the ordinary-fill band.
 *
 * `positions` maps each canonical paint to its position in the shared
 * submission order. It is required whenever that order has been replanned, so
 * images and gradients stay interleaved with the batched vector paints.
 */
export function applyThreePdfOverlayPaintOrder(
  scene: VectorScene,
  rasterGroup: THREE.Group,
  nativePaints: readonly ThreePdfOrderedPaintMesh[],
  positions?: Int32Array | null
): void {
  const rasterMeshes = collectRasterPaintMeshes(scene, rasterGroup);
  if (scene.drawRuns) {
    const gradientMeshes = collectGradientPaintMeshes(scene, nativePaints);
    scene.drawRuns.forEach((run, index) => {
      if (run.kind !== "raster" && run.kind !== "gradient-fill" && run.kind !== "gradient-stroke") return;
      const position = positions?.length === scene.drawRuns!.length ? positions[index] : index;
      for (let item = run.first; item < run.first + run.count; item++) {
        const assign = (mesh: THREE.Object3D): void => {
          mesh.renderOrder = vectorDrawRunRenderOrder(position + (item - run.first) / run.count, scene.drawRuns!.length);
          for (const child of mesh.children) {
            if (child.userData.heprMultiplyCompletion) child.renderOrder = vectorDrawRunRenderOrder(
              position + (item - run.first + 0.5) / run.count, scene.drawRuns!.length);
          }
        };
        if (run.kind === "raster") {
          for (const entry of rasterMeshes.get(item) ?? []) {
            if (item + entry.count <= run.first + run.count) assign(entry.mesh);
          }
        } else {
          const mesh = (run.kind === "gradient-fill" ? gradientMeshes.fills : gradientMeshes.strokes).get(item);
          if (mesh) assign(mesh);
        }
      }
    });
    return;
  }
  if (nativePaints.length === 0) {
    return;
  }

  const ordered: Array<{ meshes: THREE.Object3D[]; pageIndex: number; paintOrder: number; stableIndex: number }> = [];
  const rasterLayers = Array.isArray(scene.rasterLayers)
    ? (scene.rasterLayers as OrderedRasterLayer[])
    : [];
  let rasterIndex = 0;

  for (const layer of rasterLayers) {
    const width = Math.max(0, Math.trunc(Number(layer?.width) || 0));
    const height = Math.max(0, Math.trunc(Number(layer?.height) || 0));
    const data = layer?.data;
    if (
      width <= 0 ||
      height <= 0 ||
      !(data instanceof Uint8Array) ||
      data.length < width * height * 4
    ) {
      continue;
    }

    const meshes = rasterMeshes.get(rasterIndex++)?.map(entry => entry.mesh) ?? [];
    const paintOrder = Number(layer.paintOrder);
    const pageIndex = Number(layer.pageIndex);
    if (meshes.length === 0 || !Number.isFinite(paintOrder) || !Number.isFinite(pageIndex)) {
      continue;
    }
    ordered.push({
      meshes,
      paintOrder,
      pageIndex,
      stableIndex: ordered.length
    });
  }

  for (const paint of nativePaints) {
    if (!Number.isFinite(paint.paintOrder) || !Number.isFinite(paint.pageIndex)) {
      continue;
    }
    ordered.push({ meshes: [paint.mesh], pageIndex: paint.pageIndex, paintOrder: paint.paintOrder, stableIndex: ordered.length });
  }

  if (ordered.length === 0) {
    return;
  }

  ordered.sort((left, right) =>
    left.pageIndex - right.pageIndex ||
    left.paintOrder - right.paintOrder ||
    left.stableIndex - right.stableIndex
  );

  const span = HEPR_THREE_LAYER_ORDER_FILL - HEPR_THREE_LAYER_ORDER_RASTER;
  for (let i = 0; i < ordered.length; i += 1) {
    const renderOrder = HEPR_THREE_LAYER_ORDER_RASTER + span * ((i + 1) / (ordered.length + 1));
    for (const mesh of ordered[i].meshes) mesh.renderOrder = renderOrder;
  }
}

/**
 * Key the gradient meshes by the primitive each one paints. Empty or truncated
 * gradient runs are skipped when the layer is built, so mesh positions are not
 * interchangeable with scene primitive indices.
 */
function collectGradientPaintMeshes(
  scene: VectorScene,
  nativePaints: readonly ThreePdfOrderedPaintMesh[]
): { fills: Map<number, THREE.Object3D>; strokes: Map<number, THREE.Object3D> } {
  const fills = new Map<number, THREE.Object3D>();
  const strokes = new Map<number, THREE.Object3D>();
  nativePaints.forEach((paint, position) => {
    const fill = paint.primitiveKind === undefined
      ? position < scene.gradientFillPathCount
      : paint.primitiveKind === "gradient-fill";
    const index = paint.primitiveIndex ?? (fill ? position : position - scene.gradientFillPathCount);
    (fill ? fills : strokes).set(index, paint.mesh);
  });
  return { fills, strokes };
}

/** Originals and render-only batches can share a canonical first image. */
function collectRasterPaintMeshes(scene: VectorScene, group: THREE.Group): Map<number, RasterPaintMesh[]> {
  const entries = new Map<number, RasterPaintMesh[]>();
  for (const mesh of group.children) {
    const run = mesh.userData.heprDrawRun;
    if (mesh.userData.heprPageBackground || run?.kind !== "raster") continue;
    if (!Number.isInteger(run.first) || run.first < 0 || !Number.isInteger(run.count) || run.count < 1) continue;
    let aliases = entries.get(run.first);
    if (!aliases) entries.set(run.first, aliases = []);
    aliases.push({ mesh, count: run.count });
  }
  if (entries.size > 0) return entries;

  // Older adapter-created groups may not carry canonical metadata. Preserve
  // their positional convention; current merged backgrounds are explicitly tagged.
  const markedBackgrounds = group.children.some(mesh => mesh.userData.heprPageBackground);
  const legacyMeshes = markedBackgrounds ? group.children.filter(mesh => !mesh.userData.heprPageBackground)
    : group.children.slice(Math.max(1, Math.floor(scene.pageRects.length / 4)));
  legacyMeshes.forEach((mesh, first) => entries.set(first, [{ mesh, count: 1 }]));
  return entries;
}
