import * as THREE from "three";
import type { PrimitiveKind } from "./scenePrimitives";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { ScenePageViews } from "./scenePageViews";
import { getOrBuildTextLod } from "./textLodCore";

export interface ThreePageBinding {
  table: ThreePageTransforms;
  /** Primitive ID attribute and immutable primitive -> page indirection. */
  attribute?: string;
  owners?: THREE.DataTexture;
  /** A constant page, or aPageIndex for instanced backgrounds/raster strips. */
  page?: number;
}

/** Geometry stays canonical. Only the small matrix/visibility tables are mutable. */
export class ThreePageTransforms {
  readonly matrices: THREE.DataTexture;
  readonly parameters: THREE.DataTexture;
  readonly projections: THREE.Matrix4[];
  readonly visibility: Uint8Array;
  readonly coarseBounds: Bounds[];
  readonly runPages: Uint16Array | null;
  readonly projectionElements: readonly number[][];
  revision = 0;
  minUnitsPerPixel = 1;
  maxUnitsPerPixel = 1;
  opaque = false;
  private readonly partition: ScenePageViews;
  private readonly owned = new Set<THREE.DataTexture>();
  private readonly ownerCache = new Map<Uint32Array, THREE.DataTexture>();
  private matrixDirty = false;
  private disposed = false;
  private parametersDirty = false;
  private projectionDirty = false;

  constructor(partition: ScenePageViews) {
    this.partition = partition;
    // Only single-page runs can use the stronger independence proof. Public
    // scenes may provide a run spanning pages; those keep the ordinary scheduler.
    const runs = partition.scene.drawRuns;
    const pages = runs ? new Uint16Array(runs.length) : null;
    let singlePage = true;
    runs?.forEach((run, index) => {
      const owners = partition.owners[run.kind], page = owners[run.first] ?? 0;
      for (let i = run.first; i < run.first + run.count; i++) if (owners[i] !== page) { singlePage = false; break; }
      pages![index] = page;
    });
    this.runPages = singlePage ? pages : null;
    const count = partition.pageCount;
    if (count > 4096) throw new RangeError("Page transform table exceeds material capacity.");
    this.matrices = texture(new Float32Array(count * 16), 4, count);
    this.parameters = texture(new Float32Array(count * 4), 1, count);
    this.coarseBounds = Array.from({ length: count }, () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }));
    this.projections = Array.from({ length: count }, () => new THREE.Matrix4());
    this.visibility = new Uint8Array(count);
    this.projectionElements = this.projections.map(matrix => matrix.elements);
  }

  get requiredTextureDimension(): number {
    let dimension = Math.max(4, this.visibility.length);
    for (const owners of this.owned) dimension = Math.max(dimension, owners.image.width, owners.image.height);
    return dimension;
  }

  setPage(index: number, dataToDocument: THREE.Matrix4, dataToClip: THREE.Matrix4, visible: boolean, unitsPerPixel: number): void {
    const matrices = this.matrices.image.data as Float32Array;
    const params = this.parameters.image.data as Float32Array;
    for (let i = 0; i < 16; i++) {
      const value = Math.fround(dataToDocument.elements[i]);
      if (matrices[index * 16 + i] !== value) { matrices[index * 16 + i] = value; this.matrixDirty = true; }
    }
    const units = Math.fround(unitsPerPixel);
    if (params[index * 4] !== units || this.visibility[index] !== Number(visible)) {
      params[index * 4] = units; params[index * 4 + 1] = Number(visible);
      this.visibility[index] = Number(visible); this.parametersDirty = true;
    }
    const previous = this.projections[index].elements;
    // Text selection depends on XY/W on the z=0 page plane, not clip depth.
    // Orthographic Z animation must not rescan every glyph cluster in a book.
    for (const component of [0, 1, 3, 4, 5, 7, 12, 13, 15]) {
      if (previous[component] !== dataToClip.elements[component]) { this.projectionDirty = true; break; }
    }
    this.projections[index].copy(dataToClip);
  }

  finishUpdate(): void {
    if (this.matrixDirty) this.matrices.needsUpdate = true;
    if (this.parametersDirty) this.parameters.needsUpdate = true;
    if (this.parametersDirty || this.projectionDirty) this.revision++;
    this.matrixDirty = this.parametersDirty = this.projectionDirty = false;
  }

  page(kind: PrimitiveKind, index: number): ThreePageBinding {
    return { table: this, page: this.partition.owners[kind][index] };
  }

  instances(kind: "stroke" | "fill" | "text", scene: VectorScene, origins?: Uint32Array): ThreePageBinding {
    let owners = this.partition.owners[kind];
    if (origins) owners = Uint32Array.from(origins, origin => owners[origin]);
    else if (kind === "text" && scene.textInstanceCount > owners.length) {
      const exact = owners, data = getOrBuildTextLod(this.partition.scene).data;
      owners = new Uint32Array(scene.textInstanceCount); owners.set(exact);
      if (!data || data.combinedInstanceCount !== owners.length) throw new Error("Missing coarse text page ownership.");
      for (const run of data.runs) if (run.coarseIndex >= 0) {
        owners[exact.length + run.coarseIndex] = run.pageIndex;
        const bounds = this.coarseBounds[run.pageIndex];
        bounds.minX = Math.min(bounds.minX, run.bounds.minX); bounds.minY = Math.min(bounds.minY, run.bounds.minY);
        bounds.maxX = Math.max(bounds.maxX, run.bounds.maxX); bounds.maxY = Math.max(bounds.maxY, run.bounds.maxY);
      }
    } else if (kind === "stroke" && scene.segmentCount !== owners.length) {
      // Legacy LOD without canonical paint origins retains the original layout.
      owners = Uint32Array.from({ length: scene.segmentCount }, (_, index) => {
        const b = scene.primitiveBounds, i = index * 4;
        return this.partition.pageAt((b[i] + b[i + 2]) / 2, (b[i + 1] + b[i + 3]) / 2);
      });
    }
    let store = this.ownerCache.get(owners);
    if (!store) {
      // Switching LOD/material modes can recreate equivalent origin arrays.
      // Reuse their immutable texture instead of retaining another copy.
      for (const [previous, candidate] of this.ownerCache) {
        if (previous.length === owners.length && previous.every((page, i) => page === owners[i])) { store = candidate; break; }
      }
    }
    if (!store) {
      const width = Math.min(4096, Math.max(1, Math.ceil(Math.sqrt(owners.length))));
      const height = Math.max(1, Math.ceil(owners.length / width));
      if (height > 4096) throw new RangeError("Primitive page table exceeds material capacity.");
      const data = new Float32Array(width * height); data.set(owners);
      store = texture(data, width, height, THREE.RedFormat);
      this.ownerCache.set(owners, store); this.owned.add(store);
    }
    return { table: this, owners: store, attribute: kind === "stroke" ? "aSegmentIndex" : kind === "fill" ? "aFillPathIndex" : "aTextInstanceIndex" };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.matrices.dispose(); this.parameters.dispose();
    for (const item of this.owned) item.dispose();
    this.owned.clear(); this.ownerCache.clear();
  }
}

function texture(data: Float32Array, width: number, height: number, format: THREE.PixelFormat = THREE.RGBAFormat): THREE.DataTexture {
  const result = new THREE.DataTexture(data, width, height, format, THREE.FloatType);
  result.minFilter = result.magFilter = THREE.NearestFilter;
  result.generateMipmaps = false; result.needsUpdate = true;
  return result;
}

/** Install before clip/Multiply clones, which share these uniform references. */
export function bindRawPageTransform(material: THREE.Material, binding?: ThreePageBinding): void {
  if (!binding || !(material instanceof THREE.RawShaderMaterial)) return;
  const page = binding.owners ? `int(texelFetch(uPageOwners, ivec2(int(${binding.attribute}) % uPageOwnerWidth, int(${binding.attribute}) / uPageOwnerWidth), 0).r)`
    : binding.page === undefined ? "int(aPageIndex)" : String(binding.page);
  const declaration = "uniform mat4 uLocalToClip;";
  if (!material.vertexShader.includes(declaration)) throw new Error("Page shader has no document projection.");
  const code = `uniform mat4 uDocumentToClip;
    uniform highp sampler2D uPageMatrices;
    uniform highp sampler2D uPageParameters;
    ${binding.owners ? "uniform highp sampler2D uPageOwners; uniform int uPageOwnerWidth;" : binding.page === undefined ? "in float aPageIndex;" : ""}
    int heprPageIndex();
    mat4 heprPageProjection() {
      int p = heprPageIndex();
      return uDocumentToClip * mat4(texelFetch(uPageMatrices, ivec2(0,p),0), texelFetch(uPageMatrices, ivec2(1,p),0),
        texelFetch(uPageMatrices, ivec2(2,p),0), texelFetch(uPageMatrices, ivec2(3,p),0));
    }
    #define uLocalToClip heprPageProjection()
  `;
  material.vertexShader = material.vertexShader.replace(declaration, code)
    .replace("uniform float uLocalUnitsPerPixel;", "#define uLocalUnitsPerPixel texelFetch(uPageParameters, ivec2(0,heprPageIndex()),0).r")
    .replace(/void main\s*\(\s*\)\s*\{/, "void heprPageMain() {") + `
    int heprPageIndex() { return ${page}; }
    void main() {
      heprPageMain();
      if (texelFetch(uPageParameters, ivec2(0,heprPageIndex()),0).g < 0.5) gl_Position = vec4(2.0,2.0,2.0,1.0);
    }`;
  material.uniforms.uDocumentToClip = material.uniforms.uLocalToClip;
  material.uniforms.uPageMatrices = { value: binding.table.matrices };
  material.uniforms.uPageParameters = { value: binding.table.parameters };
  if (binding.owners) {
    material.uniforms.uPageOwners = { value: binding.owners };
    material.uniforms.uPageOwnerWidth = { value: binding.owners.image.width };
  }
}
