import { createThreeMultiplyMaterial } from "./threeVectorMultiply";
import { createThreeInstanceVectorClipMaterial, createThreeVectorClipMaterial,
  VECTOR_CLIP_INSTANCE_ATTRIBUTE } from "./threeVectorClips";
import * as THREE from "three";
import { createDefaultOptionalContentSnapshot, type OptionalContentSnapshot } from "./optionalContent";
import { ScenePaintVisibility } from "./scenePaintVisibility";
import { scenePaintRunNeighbours } from "./scenePaintGraph";
import { getThreeVectorDrawPlan, type ThreeVectorDrawPlan } from "./threeVectorDrawPlan";
import { VectorStrokeRedundancy } from "./vectorStrokeRedundancy";
import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { HEPR_THREE_LAYER_ORDER_RASTER, HEPR_THREE_LAYER_ORDER_TEXT } from "./threeLayerOrder";

export function vectorDrawRunRenderOrder(index: number, count: number): number {
  return HEPR_THREE_LAYER_ORDER_RASTER +
    (HEPR_THREE_LAYER_ORDER_TEXT - HEPR_THREE_LAYER_ORDER_RASTER) * ((index + 1) / (count + 1));
}

/** A canonical paint range, or the single instance a Multiply pass expands to. */
interface DrawRunRange {
  run: VectorDrawRun;
  index: number;
  first: number;
  count: number;
  ids?: Uint32Array;
}

interface DrawRunEntry {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  ranges: readonly DrawRunRange[];
  ids: THREE.InstancedBufferAttribute;
  idValues: Float32Array;
  /** Present only when the entry spans more than one clip root. */
  clipCodes: THREE.InstancedBufferAttribute | null;
  clipValues: Float32Array | null;
}

/** Share material/textures and batch compatible paints without changing canonical ranges. */
export class ThreeVectorDrawRuns {
  private entries: DrawRunEntry[] = [];
  private readonly visibility: ScenePaintVisibility;
  private snapshot: OptionalContentSnapshot;
  private readonly clipMaterials = new Map<string, THREE.Material>();
  private readonly visibleIds: Uint8Array;
  private readonly strokeRedundancy: VectorStrokeRedundancy | null;
  private readonly strokeCandidates: Uint32Array | null;
  private strokeRedundancyEnabled = true;
  private sourceCount: number;
  private sourceVersion = -1;
  private enabled = true;
  private readonly scene: VectorScene;
  private readonly kind: VectorDrawRun["kind"];
  private readonly parent: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  private readonly attribute: string;
  private readonly neighbours: Uint8Array | null;
  private readonly plan: ThreeVectorDrawPlan;
  private planVersion = -1;
  private readonly origins: Uint32Array | undefined;
  private readonly idsByRun = new Map<number, Uint32Array>();

  static create(scene: VectorScene, kind: VectorDrawRun["kind"],
    parent: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>, attribute: string,
    plan?: ThreeVectorDrawPlan, origins?: Uint32Array): ThreeVectorDrawRuns | null {
    return scene.drawRuns ? new ThreeVectorDrawRuns(scene, kind, parent, attribute, plan, origins) : null;
  }

  private constructor(scene: VectorScene, kind: VectorDrawRun["kind"],
    parent: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>, attribute: string,
    plan?: ThreeVectorDrawPlan, origins?: Uint32Array) {
    this.scene = scene;
    this.origins = origins;
    this.kind = kind;
    this.parent = parent;
    this.attribute = attribute;
    this.visibility = new ScenePaintVisibility(scene);
    this.snapshot = createDefaultOptionalContentSnapshot(scene);
    this.visibility.setVisibility(this.snapshot);
    const source = parent.geometry.getAttribute(attribute);
    this.visibleIds = new Uint8Array(source.count);
    this.strokeRedundancy = kind === "stroke" && !origins && !this.visibility.requiresCompositing
      ? new VectorStrokeRedundancy(scene) : null;
    this.strokeCandidates = this.strokeRedundancy ? new Uint32Array(source.count) : null;
    this.sourceCount = parent.geometry.instanceCount;
    this.neighbours = this.visibility.requiresCompositing ? scenePaintRunNeighbours(scene) : null;
    this.plan = plan ?? getThreeVectorDrawPlan(scene);
    if (origins) {
      const sourceRuns = new Uint32Array(scene.segmentCount);
      scene.drawRuns!.forEach((run, index) => {
        if (run.kind === kind) sourceRuns.fill(index, run.first, run.first + run.count);
      });
      const lists = new Map<number, number[]>();
      origins.forEach((origin, id) => {
        const index = sourceRuns[origin];
        const ids = lists.get(index);
        if (ids) ids.push(id); else lists.set(index, [id]);
      });
      for (const [index, ids] of lists) {
        ids.sort((a, b) => origins[a] - origins[b] || a - b);
        this.idsByRun.set(index, Uint32Array.from(ids));
      }
    }
    this.rebuildEntries();
    this.finishUpdate();
    this.setEnabled(true);
  }

  beginUpdate(): void {
    this.parent.geometry.instanceCount = this.sourceCount;
  }

  finishUpdate(): void {
    const source = this.parent.geometry.getAttribute(this.attribute) as THREE.InstancedBufferAttribute;
    const count = this.parent.geometry.instanceCount;
    this.parent.geometry.instanceCount = 0;
    // A replanned submission order needs new batches even when the same
    // primitives are on screen, so it invalidates the reuse checks below.
    const replanned = this.plan.version !== this.planVersion;
    if (replanned) this.rebuildEntries();
    if (!replanned && source.version === this.sourceVersion && count === this.sourceCount) return;
    // Spatial culling can repack the same IDs in a different order. The ordered
    // batches only depend on membership, so reuse their buffers and redundancy
    // decision when no primitive actually entered or left the candidate set.
    const selected = source.array as Float32Array;
    let unchanged = !replanned && this.sourceVersion >= 0 && count === this.sourceCount;
    if (unchanged) {
      for (let i = 0; i < count; i++) {
        if (!this.visibleIds[selected[i]]) { unchanged = false; break; }
      }
    }
    this.sourceVersion = source.version;
    this.sourceCount = count;
    if (unchanged) return;
    this.visibleIds.fill(0);
    for (let i = 0; i < count; i++) this.visibleIds[selected[i]] = 1;
    this.updateEntries();
  }

  /**
   * Build one mesh per submission batch, in the shared plan's order.
   *
   * Merging is limited to paints that are adjacent in that order and share a
   * program and blend, so a batch is always a contiguous span of the submitted
   * sequence and paint order is preserved. Clip roots do not end a batch: a
   * batch spanning several of them carries the root per instance instead.
   */
  private rebuildEntries(): void {
    this.disposeEntries();
    this.planVersion = this.plan.version;
    const runs = this.scene.drawRuns!;
    const order = this.plan.order;
    for (let position = 0; position < order.length; position++) {
      const index = order[position];
      const run = runs[index];
      if (run.kind !== this.kind) continue;
      if (!this.scene.paintGraph && run.blendMode === "Multiply") {
        for (let item = 0; item < run.count; item++) {
          const range = this.range(run, index, run.first + item, 1);
          this.createEntry([range], position + item / run.count, 0);
          this.createEntry([range], position + (item + 0.5) / run.count, 1);
        }
        continue;
      }
      const ranges: DrawRunRange[] = [this.range(run, index)];
      const start = position;
      // Render-only batching removes OCG and clip boundaries from draw
      // submissions. Canonical ranges remain separate for inspection and
      // visibility. Non-normal blends keep their original pass boundaries, and
      // a composited scene merges only across paints the graph keeps side by
      // side, so one mesh never straddles a group or reorders a paint. A span
      // that then covers only part of a mesh still renders that subset.
      if (!run.blendMode) {
        let previous = run, end = run.first + run.count;
        while (position + 1 < order.length) {
          const nextIndex = order[position + 1];
          const next = runs[nextIndex];
          if (!this.canBatch(previous, order[position], next, nextIndex, end)) break;
          ranges.push(this.range(next, nextIndex));
          previous = next; end = next.first + next.count; position++;
        }
      }
      this.createEntry(ranges, start);
    }
  }

  /** Whether the next scheduled paint submits as part of the batch being built. */
  private canBatch(previous: VectorDrawRun, previousIndex: number, next: VectorDrawRun, nextIndex: number, end: number): boolean {
    if (previous.kind !== next.kind || next.blendMode) return false;
    if (this.neighbours === null) return true;
    if (this.plan.segments && this.plan.version > 0) {
      return this.plan.segments[previousIndex] === this.plan.segments[nextIndex];
    }
    // Compositing keeps the canonical order and its transparency groups, so a
    // batch may only cover paints the graph lists next to each other, and the
    // compositor still addresses them as one contiguous instance range.
    return this.neighbours[previousIndex] === 1 && previous.clipIndex === next.clipIndex && end === next.first;
  }

  private range(run: VectorDrawRun, index: number, first = run.first, count = run.count): DrawRunRange {
    const ids = this.idsByRun.get(index);
    return { run, index, first, count, ids: ids && (first === run.first && count === run.count
      ? ids : ids.filter(id => this.origins![id] >= first && this.origins![id] < first + count)) };
  }

  private createEntry(ranges: readonly DrawRunRange[], order: number, pass?: 0 | 1): void {
    const geometry = new THREE.InstancedBufferGeometry();
    for (const [name, value] of Object.entries(this.parent.geometry.attributes)) {
      if (name !== this.attribute) geometry.setAttribute(name, value);
    }
    geometry.setIndex(this.parent.geometry.index);
    let count = 0;
    let clipIndex = ranges[0].run.clipIndex ?? -1;
    let mixedClips = false;
    for (const range of ranges) {
      count += range.ids?.length ?? range.count;
      if ((range.run.clipIndex ?? -1) !== clipIndex) mixedClips = true;
    }
    if (mixedClips) clipIndex = -1;
    const ids = createInstanceAttribute(count);
    geometry.setAttribute(this.attribute, ids);
    let clipCodes: THREE.InstancedBufferAttribute | null = null;
    if (mixedClips) {
      clipCodes = createInstanceAttribute(count);
      geometry.setAttribute(VECTOR_CLIP_INSTANCE_ATTRIBUTE, clipCodes);
    }
    geometry.instanceCount = count;
    const key = `${mixedClips ? "instance" : clipIndex}:${pass ?? "normal"}`;
    let material = this.clipMaterials.get(key);
    if (!material) {
      material = mixedClips
        ? createThreeInstanceVectorClipMaterial(this.parent.material)
        : createThreeVectorClipMaterial(this.parent.material, clipIndex);
      if (pass !== undefined) {
        const clipped = material;
        material = createThreeMultiplyMaterial(clipped, pass);
        if (clipped !== this.parent.material) clipped.dispose();
      }
      if (material !== this.parent.material) this.clipMaterials.set(key, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.heprDrawRun = { ...ranges[0].run, first: ranges[0].first, count };
    // The canonical paints behind this mesh. A mesh with nothing left to draw
    // tells the compositor those paints are off screen, which is what lets it
    // drop the transparency groups that no longer contain anything.
    mesh.userData.heprDrawRunIndices = ranges.map(range => range.index);
    mesh.userData.heprDrawRanges = ranges.map(({ first, count }) => ({ first, count }));
    mesh.userData.heprCanonicalOrigins = this.origins;
    mesh.userData.heprScheduled = this.plan.version > 0;
    mesh.userData.heprInstanceAttribute = this.attribute;
    mesh.frustumCulled = false;
    mesh.renderOrder = vectorDrawRunRenderOrder(order, this.scene.drawRuns!.length);
    this.parent.add(mesh);
    this.entries.push({ mesh, ranges, ids, idValues: ids.array as Float32Array,
      clipCodes, clipValues: (clipCodes?.array as Float32Array | undefined) ?? null });
  }

  private updateEntries(): void {
    if (this.strokeRedundancy && this.strokeCandidates && this.strokeRedundancyEnabled) {
      let count = 0;
      for (const entry of this.entries) {
        for (const range of entry.ranges) {
          if (!this.visibility.isRunVisible(range.run)) continue;
          const end = range.first + range.count;
          for (let id = range.first; id < end; id++) {
            if (this.visibleIds[id]) this.strokeCandidates[count++] = id;
          }
        }
      }
      this.strokeRedundancy.update(this.strokeCandidates, count);
    }
    for (const entry of this.entries) {
      let visible = 0;
      let changed = false;
      let clipsChanged = false;
      for (const range of entry.ranges) {
        if (this.visibility.requiresCompositing
          ? range.run.optionalContent !== undefined && this.snapshot.conditions[range.run.optionalContent] === 0
          : !this.visibility.isRunVisible(range.run)) continue;
        const clipCode = (range.run.clipIndex ?? -1) + 1;
        const count = range.ids?.length ?? range.count;
        const ids = entry.idValues, clips = entry.clipValues;
        for (let item = 0; item < count; item++) {
          const id = range.ids ? range.ids[item] : range.first + item;
          if (!this.visibleIds[id]) continue;
          if (this.strokeRedundancyEnabled && this.strokeRedundancy && !this.strokeRedundancy.isRetained(id)) continue;
          if (ids[visible] !== id) { ids[visible] = id; changed = true; }
          if (clips && clips[visible] !== clipCode) { clips[visible] = clipCode; clipsChanged = true; }
          visible++;
        }
      }
      entry.mesh.geometry.instanceCount = visible;
      entry.mesh.visible = this.enabled && visible > 0;
      if (changed) markInstanceUpdate(entry.ids, visible);
      if (clipsChanged && entry.clipCodes) markInstanceUpdate(entry.clipCodes, visible);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const entry of this.entries) entry.mesh.visible = enabled && entry.mesh.geometry.instanceCount > 0;
  }

  setOptionalContentVisibility(snapshot: OptionalContentSnapshot): void {
    if (this.snapshot === snapshot) return;
    this.snapshot = snapshot;
    this.visibility.setVisibility(snapshot);
    this.updateEntries();
  }

  setStrokeRedundancyEnabled(enabled: boolean): void {
    if (this.strokeRedundancyEnabled === enabled) return;
    this.strokeRedundancyEnabled = enabled;
    if (this.strokeRedundancy) this.updateEntries();
  }

  getRenderedCount(): number {
    return this.entries.reduce((count, entry) => count + (entry.mesh.visible ? entry.mesh.geometry.instanceCount : 0), 0);
  }

  dispose(): void {
    this.disposeEntries();
    for (const material of this.clipMaterials.values()) material.dispose();
    this.clipMaterials.clear();
  }

  private disposeEntries(): void {
    for (const entry of this.entries) {
      this.parent.remove(entry.mesh);
      // Batch geometries borrow the layer's corner and index buffers. Three
      // frees the GPU buffer of every attribute a disposed geometry still
      // lists, so release the borrowed ones first: replanning must not pull
      // those buffers out from under the layer and its surviving batches.
      const geometry = entry.mesh.geometry;
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== this.attribute && name !== VECTOR_CLIP_INSTANCE_ATTRIBUTE) geometry.deleteAttribute(name);
      }
      geometry.setIndex(null);
      geometry.dispose();
    }
    this.entries = [];
  }
}

function createInstanceAttribute(count: number): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  attribute.setUsage(THREE.StreamDrawUsage);
  return attribute;
}

function markInstanceUpdate(attribute: THREE.InstancedBufferAttribute, count: number): void {
  attribute.clearUpdateRanges();
  if (count > 0) attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
}
