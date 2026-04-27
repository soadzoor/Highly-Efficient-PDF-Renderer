import * as THREE from "three";

import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import {
  buildOverviewTileLevels,
  DEFAULT_OVERVIEW_TILE_OVERLAP_PIXELS,
  overviewTileRenderConfigsMatch,
  type OverviewTileAsset,
  type OverviewTileLevel,
  type OverviewTilePyramid,
  type OverviewTileRenderConfig,
  type OverviewTileSpec
} from "./overviewTilePyramid";
import { WebGlFloorplanRenderer } from "./webGlFloorplanRenderer";

interface TiledOverviewLayerOptions {
  sceneBounds: Bounds;
  sceneCenterX: number;
  sceneCenterY: number;
  pageBackground: [number, number, number, number];
  vectorOverride: [number, number, number, number];
  strokeCurveEnabled: boolean;
  textVectorOnly: boolean;
  tileOverlapPixels?: number;
  overviewTilePyramid?: OverviewTilePyramid | null;
}

interface ViewportPixels {
  width: number;
  height: number;
}

type TileLevel = OverviewTileLevel;
type TileSpec = OverviewTileSpec;
type TileEntryState = "ready" | "loading" | "failed";

interface TileEntry {
  key: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture | null;
  state: TileEntryState;
  loadPromise: Promise<void> | null;
}

const NDC_TILE_VISIBILITY_MARGIN = 0.08;

export class ThreeTiledOverviewLayer {
  readonly group = new THREE.Group();

  private readonly scene: VectorScene;
  private readonly options: TiledOverviewLayerOptions;
  private readonly levels: TileLevel[];
  private readonly prebuiltAssetsByKey: Map<string, OverviewTileAsset> | null;
  private readonly entries = new Map<string, TileEntry>();
  private readonly visibleKeys = new Set<string>();
  private tileRenderer: WebGlFloorplanRenderer | null = null;
  private renderCanvas: HTMLCanvasElement | null = null;

  constructor(scene: VectorScene, options: TiledOverviewLayerOptions) {
    this.scene = scene;
    this.options = options;
    this.group.visible = false;
    this.group.name = "hepr-tiled-overview";

    const renderConfig = createOverviewTileRenderConfig(options);
    const prebuiltPyramid = selectCompatibleOverviewTilePyramid(
      options.overviewTilePyramid ?? scene.overviewTilePyramid ?? null,
      options.sceneBounds,
      renderConfig
    );
    if (prebuiltPyramid) {
      this.levels = prebuiltPyramid.levels.map((level) => ({
        index: level.index,
        config: level.config,
        specs: level.tiles
      }));
      this.prebuiltAssetsByKey = buildAssetMap(prebuiltPyramid);
    } else {
      const overlapPixels = Math.max(0, Math.trunc(options.tileOverlapPixels ?? DEFAULT_OVERVIEW_TILE_OVERLAP_PIXELS));
      this.levels = buildOverviewTileLevels(options.sceneBounds, overlapPixels);
      this.prebuiltAssetsByKey = null;
    }

    const baseLevel = this.levels[0];
    if (baseLevel) {
      for (const spec of baseLevel.specs) {
        this.ensureTileEntry(spec);
      }
    }
  }

  updateForCamera(
    camera: THREE.Camera,
    _viewport: ViewportPixels,
    pageWorldMatrix: THREE.Matrix4,
    cullingBounds: Bounds | null | undefined
  ): boolean {
    const projectedPage = projectBoundsToNdc(this.options.sceneBounds, this.options, pageWorldMatrix, camera);
    if (!projectedPage) {
      this.setVisible(false);
      return false;
    }

    const selectedLevel = this.selectLevel(projectedPage.longRatio);
    if (!selectedLevel) {
      this.setVisible(false);
      return false;
    }

    const selectedIndex = this.levels.indexOf(selectedLevel);
    const candidateLevels = this.prebuiltAssetsByKey
      ? this.levels.slice(0, selectedIndex + 1).reverse()
      : [selectedLevel];
    let activated = false;
    for (const level of candidateLevels) {
      const visibleSpecs = this.collectVisibleSpecs(level, camera, pageWorldMatrix, cullingBounds);
      if (visibleSpecs.length === 0) {
        continue;
      }
      if (this.activateSpecsWhenReady(visibleSpecs)) {
        activated = true;
        break;
      }
    }

    for (const [key, entry] of this.entries) {
      if (!this.visibleKeys.has(key)) {
        entry.mesh.visible = false;
      }
    }

    this.group.visible = activated;
    return activated;
  }

  async preloadBaseLevel(): Promise<void> {
    const baseLevel = this.levels[0];
    if (!baseLevel || !this.prebuiltAssetsByKey) {
      return;
    }

    const waits: Promise<void>[] = [];
    for (const spec of baseLevel.specs) {
      const entry = this.ensureTileEntry(spec);
      if (entry.loadPromise) {
        waits.push(entry.loadPromise);
      }
    }
    if (waits.length > 0) {
      await Promise.allSettled(waits);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    if (!visible) {
      for (const entry of this.entries.values()) {
        entry.mesh.visible = false;
      }
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      this.group.remove(entry.mesh);
      disposeTileTexture(entry.texture);
      entry.geometry.dispose();
      entry.material.dispose();
    }
    this.entries.clear();
    this.visibleKeys.clear();
    this.releaseTileRenderer();
    this.group.clear();
  }

  private selectLevel(projectedLongRatio: number): TileLevel | null {
    for (const level of this.levels) {
      if (projectedLongRatio <= level.config.maxProjectedLongRatio) {
        return level;
      }
    }
    return null;
  }

  private ensureTileEntry(spec: TileSpec): TileEntry {
    const existing = this.entries.get(spec.key);
    if (existing) {
      return existing;
    }

    const prebuiltAsset = this.prebuiltAssetsByKey?.get(spec.key) ?? null;
    const texture = prebuiltAsset ? null : this.createRuntimeTileTexture(spec);
    const geometry = createTileGeometry(spec, this.options.sceneCenterX, this.options.sceneCenterY);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = true;
    mesh.renderOrder = 4;
    mesh.visible = false;

    const entry: TileEntry = {
      key: spec.key,
      mesh,
      geometry,
      material,
      texture,
      state: texture ? "ready" : "loading",
      loadPromise: null
    };
    this.entries.set(spec.key, entry);
    this.group.add(mesh);
    if (prebuiltAsset) {
      entry.loadPromise = this.loadPrebuiltTileTexture(entry, prebuiltAsset);
    }
    return entry;
  }

  private collectVisibleSpecs(
    level: TileLevel,
    camera: THREE.Camera,
    pageWorldMatrix: THREE.Matrix4,
    cullingBounds: Bounds | null | undefined
  ): TileSpec[] {
    const specs: TileSpec[] = [];
    for (const spec of level.specs) {
      if (cullingBounds && !boundsIntersect(spec, cullingBounds)) {
        continue;
      }
      const projectedTile = projectBoundsToNdc(spec, this.options, pageWorldMatrix, camera);
      if (!projectedTile || !ndcBoundsIntersectsViewport(projectedTile)) {
        continue;
      }
      specs.push(spec);
    }
    return specs;
  }

  private activateSpecsWhenReady(specs: TileSpec[]): boolean {
    const entries: TileEntry[] = [];
    for (const spec of specs) {
      const entry = this.ensureTileEntry(spec);
      if (entry.state !== "ready" || !entry.texture) {
        return false;
      }
      entries.push(entry);
    }

    this.visibleKeys.clear();
    for (const entry of entries) {
      entry.mesh.visible = true;
      this.visibleKeys.add(entry.key);
    }
    return entries.length > 0;
  }

  private createRuntimeTileTexture(spec: TileSpec): THREE.Texture {
    const tileRenderer = this.ensureTileRenderer();
    const renderCanvas = this.renderCanvas;
    if (!renderCanvas) {
      throw new Error("Unable to create HEPR tile renderer canvas.");
    }

    const canvas = renderTileToCanvas(tileRenderer, renderCanvas, spec);
    return createTileTexture(canvas);
  }

  private async loadPrebuiltTileTexture(entry: TileEntry, asset: OverviewTileAsset): Promise<void> {
    try {
      const texture = await createTileTextureFromAsset(asset);
      if (!this.entries.has(asset.key)) {
        disposeTileTexture(texture);
        return;
      }
      entry.texture = texture;
      entry.material.map = texture;
      entry.material.needsUpdate = true;
      entry.state = "ready";
      entry.loadPromise = null;
    } catch (error) {
      entry.state = "failed";
      entry.loadPromise = null;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[HEPR] Failed to load overview tile ${asset.file}: ${message}`);
    }
  }

  private ensureTileRenderer(): WebGlFloorplanRenderer {
    if (this.tileRenderer && this.renderCanvas) {
      return this.tileRenderer;
    }

    const renderCanvas = document.createElement("canvas");
    const tileRenderer = new WebGlFloorplanRenderer(renderCanvas, { preserveDrawingBuffer: true });
    tileRenderer.setExternalFrameDriver?.(true);
    tileRenderer.setPanOptimizationEnabled(false);
    tileRenderer.setRasterRenderingEnabled?.(true);
    tileRenderer.setFillRenderingEnabled?.(true);
    tileRenderer.setStrokeRenderingEnabled?.(true);
    tileRenderer.setTextRenderingEnabled?.(true);
    tileRenderer.setStrokeCurveEnabled(this.options.strokeCurveEnabled);
    tileRenderer.setTextVectorOnly(this.options.textVectorOnly);
    tileRenderer.setPageBackgroundColor(
      this.options.pageBackground[0],
      this.options.pageBackground[1],
      this.options.pageBackground[2],
      this.options.pageBackground[3]
    );
    tileRenderer.setVectorColorOverride(
      this.options.vectorOverride[0],
      this.options.vectorOverride[1],
      this.options.vectorOverride[2],
      this.options.vectorOverride[3]
    );
    tileRenderer.setScene(this.scene);

    this.renderCanvas = renderCanvas;
    this.tileRenderer = tileRenderer;
    return tileRenderer;
  }

  private releaseTileRenderer(): void {
    this.tileRenderer?.dispose();
    this.tileRenderer = null;
    if (this.renderCanvas) {
      this.renderCanvas.width = 0;
      this.renderCanvas.height = 0;
    }
    this.renderCanvas = null;
  }
}

function createOverviewTileRenderConfig(options: TiledOverviewLayerOptions): OverviewTileRenderConfig {
  return {
    pageBackground: options.pageBackground,
    vectorOverride: options.vectorOverride,
    strokeCurveEnabled: options.strokeCurveEnabled,
    textVectorOnly: options.textVectorOnly
  };
}

function selectCompatibleOverviewTilePyramid(
  pyramid: OverviewTilePyramid | null,
  sceneBounds: Bounds,
  renderConfig: OverviewTileRenderConfig
): OverviewTilePyramid | null {
  if (!pyramid || pyramid.formatVersion !== 1 || pyramid.levels.length === 0) {
    return null;
  }
  if (!boundsApproximatelyEqual(pyramid.bounds, sceneBounds)) {
    return null;
  }
  if (!overviewTileRenderConfigsMatch(pyramid.renderConfig, renderConfig)) {
    return null;
  }
  return pyramid;
}

function buildAssetMap(pyramid: OverviewTilePyramid): Map<string, OverviewTileAsset> {
  const map = new Map<string, OverviewTileAsset>();
  for (const level of pyramid.levels) {
    for (const tile of level.tiles) {
      map.set(tile.key, tile);
    }
  }
  return map;
}

function boundsApproximatelyEqual(a: Bounds, b: Bounds): boolean {
  const epsilon = Math.max(1e-3, Math.max(a.maxX - a.minX, a.maxY - a.minY, b.maxX - b.minX, b.maxY - b.minY) * 1e-7);
  return (
    Math.abs(a.minX - b.minX) <= epsilon &&
    Math.abs(a.minY - b.minY) <= epsilon &&
    Math.abs(a.maxX - b.maxX) <= epsilon &&
    Math.abs(a.maxY - b.maxY) <= epsilon
  );
}

function renderTileToCanvas(
  renderer: WebGlFloorplanRenderer,
  renderCanvas: HTMLCanvasElement,
  spec: TileSpec
): HTMLCanvasElement {
  renderCanvas.width = spec.textureWidth;
  renderCanvas.height = spec.textureHeight;

  const tileWidth = Math.max(1e-6, spec.maxX - spec.minX);
  const tileHeight = Math.max(1e-6, spec.maxY - spec.minY);
  const zoom = Math.max(1e-6, Math.min(spec.innerWidth / tileWidth, spec.innerHeight / tileHeight));
  renderer.setViewState({
    cameraCenterX: (spec.minX + spec.maxX) * 0.5,
    cameraCenterY: (spec.minY + spec.maxY) * 0.5,
    zoom
  });
  renderer.renderExternalFrame?.(performance.now());

  const canvas = document.createElement("canvas");
  canvas.width = spec.textureWidth;
  canvas.height = spec.textureHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Unable to create 2D canvas for HEPR overview tile.");
  }
  context.drawImage(renderCanvas, 0, 0);
  return canvas;
}

function createTileTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  configureTileTexture(texture, true);
  return texture;
}

async function createTileTextureFromAsset(asset: OverviewTileAsset): Promise<THREE.Texture> {
  const bytes = await asset.loadBytes();
  const mimeType = asset.encoding === "webp" ? "image/webp" : "image/png";
  if (typeof createImageBitmap === "function") {
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: "flipY",
      premultiplyAlpha: "none"
    });
    const texture = new THREE.Texture(bitmap);
    configureTileTexture(texture, false);
    texture.needsUpdate = true;
    return texture;
  }

  const image = await loadTileHtmlImage(bytes, mimeType);
  const texture = new THREE.Texture(image);
  configureTileTexture(texture, true);
  texture.needsUpdate = true;
  return texture;
}

function configureTileTexture(texture: THREE.Texture, flipY: boolean): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = flipY;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 16;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
}

async function loadTileHtmlImage(bytes: Uint8Array, mimeType: string): Promise<HTMLImageElement> {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Tile image decode failed."));
    });
    image.src = url;
    if (typeof image.decode === "function") {
      await image.decode();
    } else {
      await loaded;
    }
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function disposeTileTexture(texture: THREE.Texture | null): void {
  if (!texture) {
    return;
  }
  const image = texture.image as { close?: () => void } | undefined;
  texture.dispose();
  if (typeof image?.close === "function") {
    image.close();
  }
}

function createTileGeometry(
  spec: TileSpec,
  sceneCenterX: number,
  sceneCenterY: number
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const minX = spec.minX - sceneCenterX;
  const minY = spec.minY - sceneCenterY;
  const maxX = spec.maxX - sceneCenterX;
  const maxY = spec.maxY - sceneCenterY;
  const positions = new Float32Array([
    minX, minY, 0,
    maxX, minY, 0,
    maxX, maxY, 0,
    minX, maxY, 0
  ]);
  const uv = new Float32Array([
    spec.uvMinX, spec.uvMinY,
    spec.uvMaxX, spec.uvMinY,
    spec.uvMaxX, spec.uvMaxY,
    spec.uvMinX, spec.uvMaxY
  ]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return geometry;
}

function projectBoundsToNdc(
  bounds: Bounds,
  options: Pick<TiledOverviewLayerOptions, "sceneCenterX" | "sceneCenterY">,
  pageWorldMatrix: THREE.Matrix4,
  camera: THREE.Camera
): { minX: number; minY: number; maxX: number; maxY: number; longRatio: number } | null {
  const corners = [
    new THREE.Vector3(bounds.minX - options.sceneCenterX, bounds.minY - options.sceneCenterY, 0),
    new THREE.Vector3(bounds.maxX - options.sceneCenterX, bounds.minY - options.sceneCenterY, 0),
    new THREE.Vector3(bounds.maxX - options.sceneCenterX, bounds.maxY - options.sceneCenterY, 0),
    new THREE.Vector3(bounds.minX - options.sceneCenterX, bounds.maxY - options.sceneCenterY, 0)
  ];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    corner.applyMatrix4(pageWorldMatrix).project(camera);
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y) || !Number.isFinite(corner.z)) {
      return null;
    }
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }

  const projectedWidthRatio = Math.max(0, maxX - minX) * 0.5;
  const projectedHeightRatio = Math.max(0, maxY - minY) * 0.5;
  return {
    minX,
    minY,
    maxX,
    maxY,
    longRatio: Math.max(projectedWidthRatio, projectedHeightRatio)
  };
}

function ndcBoundsIntersectsViewport(bounds: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return (
    bounds.maxX >= -1 - NDC_TILE_VISIBILITY_MARGIN &&
    bounds.minX <= 1 + NDC_TILE_VISIBILITY_MARGIN &&
    bounds.maxY >= -1 - NDC_TILE_VISIBILITY_MARGIN &&
    bounds.minY <= 1 + NDC_TILE_VISIBILITY_MARGIN
  );
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}
