import * as THREE from "three";
import type { ThreeMaterialFillLayer } from "./threeMaterialFillLayer";
import type { ThreeMaterialStrokeLayer } from "./threeMaterialStrokeLayer";
import { requireThreeWebGpuBackend, type ThreeWebGpuBackend } from "./threeMaterialBackend";
import { bindRawPageTransform, type ThreePageBinding } from "./threePageTransforms";
import { createThreeInstanceVectorClipMaterial, initializeThreeVectorClip } from "./threeVectorClips";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { normalizeThreeRawShaderSource, normalizeThreeStrokeRawFragmentShaderSource } from "./threeRawShaderColorSpace";
import { pdfShapeCoverageGlsl } from "./pdfShapeCoverage";
import { MIXED_VECTOR_VERTEX_SHADER_SOURCE, MIXED_VECTOR_FRAGMENT_SHADER_SOURCE,
  MIXED_VECTOR_VARYING_VECTORS } from "./nativeWebGlMixedVectorShaders";
import type { ThreeShaderCompileHost } from "./threeShaderPreparation";
import { compileThreeMixedVectorRoots } from "./threeMixedVectorPreparation";
import { getThreeRenderPerformance } from "./threeRenderPerformance";
import type { ThreeWebGpuMixedVectorMaterialState } from "./threeWebGpuMixedVectorMaterial";
import { threeVectorDrawRunsRevision } from "./threeVectorDrawRuns";

interface MixedLayerOptions {
  fill: ThreeMaterialFillLayer;
  stroke: ThreeMaterialStrokeLayer;
  materialBackend: "webgl" | "webgpu";
  webGpu?: ThreeWebGpuBackend;
  onPrepared?: () => void;
}

interface MixedHost extends ThreeShaderCompileHost {
  getContext?: () => unknown;
  init?: () => Promise<unknown>;
}

type DrawMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
type InstanceAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
interface SourceDraw {
  mesh: DrawMesh;
  sourceKind: 0 | 1 | -1;
  kind: 0 | 1 | -1;
  ids?: InstanceAttribute;
  clips?: InstanceAttribute;
  count: number;
  clipCode: number;
  version: number;
  clipVersion: number;
  order: number;
  groupOrder: number;
}
interface MixedEntry { mesh: DrawMesh; data: THREE.InstancedInterleavedBuffer; sources: SourceDraw[]; count: number; }
/** The batches under one ordinary layer mesh, valid while its revision holds. */
interface CollectedBatches {
  revision: number;
  sourceKind: 0 | 1 | -1;
  groupOrder: number;
  childCount: number;
  draws: SourceDraw[];
}
/** A layer mesh whose drawn children are all mixed, hidden as one object. */
interface HiddenParent { parent: THREE.Object3D; meshes: DrawMesh[]; }

/**
 * Borrow the ordinary layers' selected meshes and texture stores. Their culling,
 * optional content and LOD selections remain the single source of truth.
 */
export class ThreeMixedVectorLayer {
  readonly group = new THREE.Group();
  private readonly options: MixedLayerOptions;
  private material: THREE.Material | null = null;
  private state: ThreeWebGpuMixedVectorMaterialState | null = null;
  private entries: MixedEntry[] = [];
  private snapshot: SourceDraw[] = [];
  private suppressed: DrawMesh[] = [];
  private suppressedParents: THREE.Object3D[] = [];
  private readonly collectedBatches = new WeakMap<THREE.Object3D, CollectedBatches>();
  /** The last collection in traversal order, and the same draws sorted. */
  private collectedDraws: SourceDraw[] = [];
  private sortedDraws: SourceDraw[] = [];
  private groupedDraws: SourceDraw[] | null = null;
  private groups: SourceDraw[][] = [];
  private hiddenParents: HiddenParent[] = [];
  private hiddenMeshes: DrawMesh[] = [];
  /** Batch-only layer meshes from the last collection and how many batches each draws. */
  private batchParentDraws = new Map<THREE.Object3D, number>();
  private ready = false;
  private failed = false;
  private disposed = false;
  private preparing: Promise<void> | null = null;
  private readonly preparationAbort = new AbortController();
  private renderedStrokes = 0;
  private active = false;
  private fillRenderingEnabled = true;
  private strokeRenderingEnabled = true;
  private readonly vectorEnabled = new THREE.Vector2(1, 1);

  constructor(options: MixedLayerOptions) {
    this.options = options;
    this.group.name = "hepr-mixed-vectors";
    this.group.visible = false;
  }

  /** Call before source-layer updates, pipeline switches and public mutations. */
  restore(): void {
    for (const mesh of this.suppressed) mesh.visible = true;
    this.suppressed.length = 0;
    for (const parent of this.suppressedParents) parent.visible = true;
    this.suppressedParents.length = 0;
    this.group.visible = false;
    this.active = false;
  }

  getRenderedStrokeCount(): number | null { return this.active ? (this.strokeRenderingEnabled ? this.renderedStrokes : 0) : null; }

  /** Reject disabled paint kinds in the vertex stage without rebuilding batches. */
  setRenderingEnabled(fills: boolean, strokes: boolean): void {
    this.fillRenderingEnabled = fills;
    this.strokeRenderingEnabled = strokes;
    this.vectorEnabled.set(strokes ? 1 : 0, fills ? 1 : 0);
    if (this.state) {
      this.state.fillRenderingUniform.value = fills ? 1 : 0;
      this.state.strokeRenderingUniform.value = strokes ? 1 : 0;
    }
  }

  update(roots: readonly THREE.Object3D[], host: MixedHost, camera: THREE.Camera): void {
    this.restore();
    if (this.failed || this.disposed) return;
    const draws = this.collect(roots);
    if (draws !== this.groupedDraws) {
      this.groupedDraws = draws;
      this.groups = mixableGroups(draws);
      this.renderedStrokes = draws.reduce((count, draw) => count + (draw.sourceKind === 0 ? draw.count : 0), 0);
    }
    const groups = this.groups;
    if (!groups.length) return;
    // Ordinary layers share one effective Group order. If custom nested groups
    // introduce more scopes, keep those other scopes on their ordinary meshes.
    const groupOrder = groups[0][0].groupOrder;
    this.group.renderOrder = groupOrder;
    try {
      // Compilation holds borrowed geometry until its promise settles. Moving
      // the camera meanwhile continues to draw the ordinary selected meshes.
      if (this.preparing && !this.ready) return;
      if (!this.material) this.createMaterial();
      if (!sameDraws(this.snapshot, draws)) {
        this.snapshot = draws;
        let index = 0;
        for (const sources of groups) if (sources[0].groupOrder === groupOrder) this.writeEntry(index++, sources);
        for (const entry of this.entries.splice(index)) disposeEntry(entry);
        this.planSuppression();
      }
      this.syncMaterialState();
      this.syncUniforms();
      if (!this.ready) this.prepare(host, camera);
      if (!this.ready) return;
      this.suppress();
      this.active = true;
      this.group.visible = this.fillRenderingEnabled || this.strokeRenderingEnabled;
      const profile = getThreeRenderPerformance();
      profile?.add("three.mixedVectorBatches", this.entries.length);
      profile?.add("three.mixedVectorInstances", this.entries.reduce((count, entry) => count + entry.count, 0));
    } catch (error) { this.fallback(error); }
  }

  /**
   * The selected source draws in paint order. Ordinary layers can hold
   * thousands of batch meshes. Their owner (ThreeVectorDrawRuns) changes a
   * revision with any change to their membership, visibility or instances, so
   * their records are reused while it holds. An unchanged collection returns
   * the previous array, letting callers skip their own work.
   */
  private collect(roots: readonly THREE.Object3D[]): SourceDraw[] {
    const draws: SourceDraw[] = [];
    const strokeRoot = this.options.stroke.mesh, fillRoot = this.options.fill.mesh;
    const parentDraws = this.batchParentDraws;
    parentDraws.clear();
    const record = (mesh: DrawMesh, sourceKind: 0 | 1 | -1, groupOrder: number): void => {
      const run = mesh.userData.heprDrawRun;
      const count = mesh.geometry instanceof THREE.InstancedBufferGeometry ? mesh.geometry.instanceCount : 1;
      if (count <= 0 || !run) return;
      const ids = sourceKind < 0 ? undefined : mesh.geometry.getAttribute(sourceKind === 0 ? "aSegmentIndex" : "aFillPathIndex");
      const clips = mesh.geometry.getAttribute("aVectorClipIndex");
      const kind = ids && run.blendMode === undefined && !Array.isArray(mesh.material) ? sourceKind : -1;
      draws.push({ mesh, kind, sourceKind, ids, clips, count, clipCode: (run.clipIndex ?? -1) + 1,
        version: attributeVersion(ids), clipVersion: attributeVersion(clips), order: mesh.renderOrder, groupOrder });
    };
    const visit = (object: THREE.Object3D, sourceKind: 0 | 1 | -1, groupOrder: number): void => {
      if (!object.visible || object === this.group) return;
      if ((object as THREE.Group).isGroup) groupOrder = object.renderOrder;
      if (object === strokeRoot) sourceKind = 0;
      else if (object === fillRoot) sourceKind = 1;
      if ((object as THREE.Mesh).isMesh) record(object as DrawMesh, sourceKind, groupOrder);
      const revision = threeVectorDrawRunsRevision(object);
      if (revision === undefined) {
        for (const child of object.children) visit(child, sourceKind, groupOrder);
        return;
      }
      const cached = this.collectedBatches.get(object);
      if (cached && cached.revision === revision && cached.sourceKind === sourceKind && cached.groupOrder === groupOrder &&
          cached.childCount === object.children.length) {
        for (const draw of cached.draws) draws.push(draw);
        parentDraws.set(object, cached.draws.length);
        return;
      }
      const first = draws.length;
      let batchesOnly = true;
      for (const child of object.children) {
        // Batches have no children or ordering scopes of their own.
        if (child.children.length > 0 || !child.userData.heprDrawRun || !(child as THREE.Mesh).isMesh) {
          batchesOnly = false;
          visit(child, sourceKind, groupOrder);
        } else if (child.visible) record(child as DrawMesh, sourceKind, groupOrder);
      }
      if (batchesOnly) {
        this.collectedBatches.set(object, { revision, sourceKind, groupOrder, childCount: object.children.length,
          draws: draws.slice(first) });
        parentDraws.set(object, draws.length - first);
      } else this.collectedBatches.delete(object);
    };
    for (const root of roots) visit(root, -1, ancestorGroupOrder(root));
    if (sameDrawObjects(this.collectedDraws, draws)) return this.sortedDraws;
    this.collectedDraws = draws;
    this.sortedDraws = draws.slice().sort((a, b) => a.groupOrder - b.groupOrder || a.order - b.order);
    return this.sortedDraws;
  }

  /**
   * Hide a layer mesh instead of each batch when every child it would draw is
   * mixed: Three then skips the whole subtree. The layer mesh itself must not
   * draw, which suppress() checks every frame.
   */
  private planSuppression(): void {
    const byParent = new Map<THREE.Object3D, DrawMesh[]>();
    this.hiddenMeshes = [];
    for (const entry of this.entries) for (const source of entry.sources) {
      const parent = source.mesh.parent;
      if (!parent) { this.hiddenMeshes.push(source.mesh); continue; }
      const meshes = byParent.get(parent);
      if (meshes) meshes.push(source.mesh); else byParent.set(parent, [source.mesh]);
    }
    this.hiddenParents = [];
    for (const [parent, meshes] of byParent) {
      // The collection counted every batch a batch-only layer would draw. Any
      // other child, or a batch left out of the mixed draw, keeps it visible.
      if (this.batchParentDraws.get(parent) === meshes.length) this.hiddenParents.push({ parent, meshes });
      else for (const mesh of meshes) this.hiddenMeshes.push(mesh);
    }
  }

  private suppress(): void {
    for (const { parent, meshes } of this.hiddenParents) {
      if (drawsItself(parent)) {
        for (const mesh of meshes) { mesh.visible = false; this.suppressed.push(mesh); }
      } else { parent.visible = false; this.suppressedParents.push(parent); }
    }
    for (const mesh of this.hiddenMeshes) { mesh.visible = false; this.suppressed.push(mesh); }
  }

  private createMaterial(): void {
    const fill = this.options.fill.getMixedVectorResources(), stroke = this.options.stroke.getMixedVectorResources();
    const pageBinding: ThreePageBinding | undefined = stroke.pageBinding ? { table: stroke.pageBinding.table } : undefined;
    let material: THREE.Material;
    if (this.options.materialBackend === "webgpu") {
      this.state = requireThreeWebGpuBackend(this.options.webGpu).createThreeWebGpuMixedVectorMaterial({
        ...fill.options, ...stroke.options, pageBinding });
      material = this.state.material;
    } else {
      const fillMaterial = this.options.fill.mesh.material as THREE.RawShaderMaterial;
      const strokeMaterial = this.options.stroke.mesh.material as THREE.RawShaderMaterial;
      material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3,
        // Three projects fills directly. Remove the unused native bounds sampler
        // so it does not consume a texture unit on smaller WebGL contexts.
        vertexShader: normalizeThreeRawShaderSource(pdfShapeCoverageGlsl(MIXED_VECTOR_VERTEX_SHADER_SOURCE))
          .replace("uniform int uFillClipBoundsEnabled;", "const int uFillClipBoundsEnabled = 0;"),
        fragmentShader: normalizeThreeStrokeRawFragmentShaderSource(pdfShapeCoverageGlsl(MIXED_VECTOR_FRAGMENT_SHADER_SOURCE)),
        uniforms: { ...fillMaterial.uniforms, ...strokeMaterial.uniforms,
          uMixedVectorEnabled: { value: this.vectorEnabled } },
        defines: { HEPR_SPLIT_STROKE_STORE: "" }, depthTest: strokeMaterial.depthTest,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      bindRawPageTransform(material, pageBinding);
    }
    configureStraightAlphaBlending(material);
    material.depthTest = this.options.stroke.mesh.material.depthTest;
    this.material = material;
    initializeThreeVectorClip(material, stroke.clipTexture);
    const clipped = createThreeInstanceVectorClipMaterial(material);
    if (clipped !== material) { material.dispose(); this.material = clipped; }
    this.setRenderingEnabled(this.fillRenderingEnabled, this.strokeRenderingEnabled);
  }

  /**
   * Fill mixed entry `index` with `sources`. Panning changes the selection
   * every frame, so an entry keeps its geometry and buffer while they fit and
   * rewrites only the instances in use.
   */
  private writeEntry(index: number, sources: SourceDraw[]): void {
    const sourceGeometry = sources[0].mesh.geometry;
    const count = sources.reduce((total, source) => total + source.count, 0);
    let entry: MixedEntry | undefined = this.entries[index];
    if (entry && entry.data.array.length < count * 4) { disposeEntry(entry); entry = undefined; }
    const reused = entry !== undefined;
    if (!entry) {
      const geometry = new THREE.InstancedBufferGeometry();
      // Headroom keeps a slowly growing selection from reallocating every frame.
      const data = new THREE.InstancedInterleavedBuffer(new Float32Array(Math.max(4, Math.ceil(count * 1.25) * 4)), 4)
        .setUsage(THREE.StreamDrawUsage);
      geometry.setAttribute("aVectorIndex", new THREE.InterleavedBufferAttribute(data, 1, 0));
      geometry.setAttribute("aVectorClipIndex", new THREE.InterleavedBufferAttribute(data, 1, 1));
      geometry.setAttribute("aVectorKind", new THREE.InterleavedBufferAttribute(data, 1, 2));
      if (this.options.stroke.getMixedVectorResources().pageBinding) {
        geometry.setAttribute("aPageIndex", new THREE.InterleavedBufferAttribute(data, 1, 3));
      }
      const mesh = new THREE.Mesh(geometry, this.material!);
      mesh.frustumCulled = false;
      mesh.userData.heprMixedVector = true;
      this.group.add(mesh);
      entry = { mesh, data, sources, count };
      this.entries[index] = entry;
    }
    const geometry = entry.mesh.geometry;
    if (geometry.getAttribute("aCorner") !== sourceGeometry.getAttribute("aCorner")) {
      geometry.setAttribute("aCorner", sourceGeometry.getAttribute("aCorner"));
    }
    if (geometry.index !== sourceGeometry.index) geometry.setIndex(sourceGeometry.index);
    const values = entry.data.array as Float32Array;
    const strokePages = this.options.stroke.getMixedVectorResources().pageBinding?.owners?.image.data;
    const fillPages = this.options.fill.getMixedVectorResources().pageBinding?.owners?.image.data;
    let offset = 0;
    for (const source of sources) {
      const pages = (source.kind === 0 ? strokePages : fillPages) as Float32Array | undefined;
      const ids = plainValues(source.ids!), clips = source.clips ? plainValues(source.clips) : null;
      for (let item = 0; item < source.count; item++) {
        const id = ids ? ids[item] : source.ids!.getX(item);
        values[offset++] = id;
        values[offset++] = source.clips ? clips ? clips[item] : source.clips.getX(item) : source.clipCode;
        values[offset++] = source.kind;
        values[offset++] = pages?.[id] ?? 0;
      }
    }
    // A new buffer uploads whole on first use.
    if (reused) {
      entry.data.clearUpdateRanges();
      entry.data.addUpdateRange(0, count * 4);
      entry.data.needsUpdate = true;
    }
    geometry.instanceCount = count;
    entry.mesh.renderOrder = sources[0].order;
    entry.sources = sources;
    entry.count = count;
    getThreeRenderPerformance()?.add("three.mixedVectorInstanceUploadBytes", count * 16);
  }

  private syncUniforms(): void {
    if (!this.state) return; // Raw materials borrow the exact source uniforms.
    const source = this.options.stroke.getMixedVectorResources();
    this.state.zoomUniform.value = source.zoomUniform.value;
    this.state.useLocalToClipUniform.value = source.useLocalToClipUniform.value;
    this.state.localUnitsPerPixelUniform.value = source.localUnitsPerPixelUniform.value;
    this.state.curveUniform.value = source.curveUniform.value;
  }

  private syncMaterialState(): void {
    const material = this.material!, source = this.options.stroke.mesh.material;
    const changed = material.depthTest !== source.depthTest || material.depthFunc !== source.depthFunc ||
      material.polygonOffset !== source.polygonOffset || material.polygonOffsetFactor !== source.polygonOffsetFactor ||
      material.polygonOffsetUnits !== source.polygonOffsetUnits;
    if (!changed) return;
    material.depthTest = source.depthTest;
    material.depthFunc = source.depthFunc;
    material.polygonOffset = source.polygonOffset;
    material.polygonOffsetFactor = source.polygonOffsetFactor;
    material.polygonOffsetUnits = source.polygonOffsetUnits;
    material.needsUpdate = true;
    if (this.options.materialBackend === "webgpu") {
      // Three's depth state is part of its GPU pipeline. Verify its replacement
      // before suppressing the ordinary paints after a page/depth mode change.
      this.ready = false;
      this.preparing = null;
    }
  }

  private prepare(host: MixedHost, camera: THREE.Camera): void {
    if (this.options.materialBackend === "webgl") {
      const gl = host.getContext?.() as WebGL2RenderingContext | null;
      if (!gl?.createShader) throw new Error("A WebGL 2 context is required to prepare mixed vector shaders.");
      const pages = !!this.options.stroke.getMixedVectorResources().pageBinding;
      if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < (pages ? 13 : 11) ||
          gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 3 ||
          gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) < (pages ? 16 : 14) ||
          gl.getParameter(gl.MAX_VARYING_VECTORS) < MIXED_VECTOR_VARYING_VECTORS) {
        throw new Error("The context cannot bind the mixed vector shader's textures and varyings.");
      }
      probeRawMaterial(gl, this.material as THREE.RawShaderMaterial);
      this.ready = true;
    } else if (!this.preparing) {
      if (!host.compileAsync) throw new Error("The host cannot prepare optional WebGPU materials.");
      this.preparing = compileThreeMixedVectorRoots(host, camera, [this.group], this.preparationAbort.signal).then(() => {
        if (this.disposed || this.failed) return;
        this.ready = true;
        this.options.onPrepared?.();
      }, error => { if (!this.disposed) this.fallback(error); });
    }
  }

  private fallback(error: unknown): void {
    this.restore();
    this.failed = true;
    this.preparationAbort.abort();
    this.disposeEntries();
    this.material?.dispose();
    this.material = null;
    this.state = null;
    console.warn("[HEPR] Three mixed vector batching is unavailable; using ordinary vector draws.",
      error instanceof Error ? error.message : String(error));
  }

  private disposeEntries(): void {
    for (const entry of this.entries) disposeEntry(entry);
    this.entries = [];
  }

  dispose(): void {
    this.restore();
    this.disposed = true;
    this.preparationAbort.abort();
    this.snapshot = [];
    this.group.removeFromParent();
    const release = () => {
      this.disposeEntries();
      this.material?.dispose();
      this.material = null; this.state = null;
    };
    if (this.preparing && !this.ready) void this.preparing.then(release);
    else release();
  }
}

function attributeVersion(attribute?: InstanceAttribute): number {
  return attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.version : attribute?.version ?? -1;
}

/** Split paint-ordered draws at barriers; only spans holding both kinds gain from one shader. */
function mixableGroups(draws: readonly SourceDraw[]): SourceDraw[][] {
  const groups: SourceDraw[][] = [];
  for (let first = 0; first < draws.length;) {
    let end = first, strokes = 0, fills = 0;
    while (end < draws.length && draws[end].kind >= 0 && draws[end].groupOrder === draws[first].groupOrder) {
      if (draws[end].kind === 0) strokes += draws[end].count; else fills += draws[end].count;
      end++;
    }
    if (strokes && fills) groups.push(draws.slice(first, end));
    first = Math.max(end, first + 1);
  }
  return groups;
}

/** Borrowed corner/index buffers detach first: Three frees every buffer a disposed geometry lists. */
function disposeEntry(entry: MixedEntry): void {
  entry.mesh.removeFromParent();
  entry.mesh.geometry.deleteAttribute("aCorner");
  entry.mesh.geometry.setIndex(null);
  entry.mesh.geometry.dispose();
}

/** A one-component attribute's own values, for reading without per-item accessors. */
function plainValues(attribute: InstanceAttribute): ArrayLike<number> | null {
  return attribute instanceof THREE.InterleavedBufferAttribute || attribute.itemSize !== 1 ? null : attribute.array;
}

function sameDrawObjects(previous: readonly SourceDraw[], next: readonly SourceDraw[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index++) if (previous[index] !== next[index]) return false;
  return true;
}

function drawsItself(object: THREE.Object3D): boolean {
  if (!(object as THREE.Mesh).isMesh) return false;
  const geometry = (object as THREE.Mesh).geometry;
  return !(geometry instanceof THREE.InstancedBufferGeometry) || geometry.instanceCount > 0;
}

function sameDraws(previous: SourceDraw[], next: SourceDraw[]): boolean {
  if (previous === next) return true;
  return previous.length === next.length && previous.every((draw, index) => {
    const other = next[index];
    return draw.mesh === other.mesh && draw.ids === other.ids && draw.clips === other.clips &&
      draw.kind === other.kind && draw.count === other.count && draw.version === other.version &&
      draw.clipVersion === other.clipVersion && draw.clipCode === other.clipCode && draw.order === other.order &&
      draw.groupOrder === other.groupOrder;
  });
}

function ancestorGroupOrder(object: THREE.Object3D): number {
  for (let parent = object.parent; parent; parent = parent.parent) {
    if ((parent as THREE.Group).isGroup) return parent.renderOrder;
  }
  return 0;
}

/** Link an optional raw program before replacing any ordinary source mesh. */
function probeRawMaterial(gl: WebGL2RenderingContext, material: THREE.RawShaderMaterial): void {
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, material.vertexShader], [gl.FRAGMENT_SHADER, material.fragmentShader]] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error("Unable to create optional mixed vector shader.");
      shaders.push(shader);
      gl.shaderSource(shader, `#version 300 es\n#define HEPR_SPLIT_STROKE_STORE\n${source}`);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Mixed vector shader compilation failed.");
    }
    program = gl.createProgram();
    if (!program) throw new Error("Unable to create optional mixed vector program.");
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Mixed vector shader linking failed.");
  } finally {
    if (program) gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
  }
}
