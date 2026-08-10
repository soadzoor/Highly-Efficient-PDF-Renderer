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
}

interface OrderedRasterLayer {
  width?: number;
  height?: number;
  data?: unknown;
  paintOrder?: number;
  pageIndex?: number;
}

/**
 * Interleave sparse native gradient paints with extracted image layers while
 * keeping the complete group below the ordinary-fill band.
 */
export function applyThreePdfOverlayPaintOrder(
  scene: VectorScene,
  rasterGroup: THREE.Group,
  nativePaints: readonly ThreePdfOrderedPaintMesh[]
): void {
  if (nativePaints.length === 0) {
    return;
  }

  const ordered: Array<ThreePdfOrderedPaintMesh & { stableIndex: number }> = [];
  const pageBackgroundCount = Math.max(1, Math.floor(scene.pageRects.length / 4));
  const rasterLayers = Array.isArray(scene.rasterLayers)
    ? (scene.rasterLayers as OrderedRasterLayer[])
    : [];
  let rasterChildIndex = pageBackgroundCount;

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

    const mesh = rasterGroup.children[rasterChildIndex];
    rasterChildIndex += 1;
    const paintOrder = Number(layer.paintOrder);
    const pageIndex = Number(layer.pageIndex);
    if (!mesh || !Number.isFinite(paintOrder) || !Number.isFinite(pageIndex)) {
      continue;
    }
    ordered.push({
      mesh,
      paintOrder,
      pageIndex,
      stableIndex: ordered.length
    });
  }

  for (const paint of nativePaints) {
    if (!Number.isFinite(paint.paintOrder) || !Number.isFinite(paint.pageIndex)) {
      continue;
    }
    ordered.push({ ...paint, stableIndex: ordered.length });
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
    ordered[i].mesh.renderOrder =
      HEPR_THREE_LAYER_ORDER_RASTER + span * ((i + 1) / (ordered.length + 1));
  }
}
