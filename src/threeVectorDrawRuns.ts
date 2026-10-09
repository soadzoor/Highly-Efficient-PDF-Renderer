import type { OrderedTextLodSelection } from "./orderedTextLod";
import { createThreeMultiplyMaterial } from "./threeVectorMultiply";
import { createThreeInstanceVectorClipMaterial, createThreeVectorClipMaterial,
  VECTOR_CLIP_INSTANCE_ATTRIBUTE } from "./threeVectorClips";
import * as THREE from "three";
import { getThreeRenderPerformance } from "./threeRenderPerformance";
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
  /** First static paint rank of this LOD range. */
  rankFirst: number;
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
  /** Visible IDs that may be culled; only strokes sharing a line qualify. */
  private strokeCandidates: Uint32Array | null;
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
  private readonly lodIdToRank: Uint32Array | null = null;
  private readonly selectedRankBits: Uint32Array | null = null;
  private readonly selectedRankWords: Uint32Array | null = null;
  private selectedRanks = new Uint32Array(0);
  private selectedRankCount = 0;
  private textSelection: OrderedTextLodSelection | null = null;
  private textSelectionRevision = -1;

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
    this.strokeCandidates = this.strokeRedundancy ? new Uint32Array(this.strokeRedundancy.candidateCount) : null;
    this.sourceCount = parent.geometry.instanceCount;
    this.neighbours = this.visibility.requiresCompositing ? scenePaintRunNeighbours(scene) : null;
    this.plan = plan ?? getThreeVectorDrawPlan(scene);
    if (origins) {
      this.lodIdToRank = new Uint32Array(source.count);
      this.selectedRankBits = new Uint32Array(Math.ceil(source.count / 32));
      this.selectedRankWords = new Uint32Array(Math.ceil(this.selectedRankBits.length / 32));
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
      let rank = 0;
      for (const [index, ids] of lists) {
        ids.sort((a, b) => origins[a] - origins[b] || a - b);
        this.idsByRun.set(index, Uint32Array.from(ids));
        for (const id of ids) this.lodIdToRank[id] = rank++;
      }
    }
    if (this.plan.deferInitialBatches) {
      // The factory will supply the camera scale before the first layer update.
      // Allocating canonical batches now can create thousands of meshes that
      // the first scheduled update immediately discards. Keep the source count
      // for beginUpdate(), but submit neither the parent nor any child yet.
      this.parent.geometry.instanceCount = 0;
    } else {
      this.rebuildEntries();
      this.finishUpdate();
    }
    this.setEnabled(true);
  }

  setTextSelection(selection: OrderedTextLodSelection | null): void {
    if (this.textSelection === selection) return;
    this.textSelection = selection;
    this.textSelectionRevision = -1;
    this.sourceVersion = -1;
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
    if (this.textSelection) {
      if (replanned || this.textSelectionRevision !== this.textSelection.revision) {
        this.textSelectionRevision = this.textSelection.revision;
        this.updateEntries();
      }
      return;
    }
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
    if (this.lodIdToRank) this.updateSelectedRanks(selected, count);
    this.updateEntries();
  }

  /** Filter the static LOD paint order without scanning every stored level. */
  private updateSelectedRanks(selected: Float32Array, count: number): void {
    if (this.selectedRanks.length < count) {
      this.selectedRanks = new Uint32Array(Math.min(this.visibleIds.length,
        Math.max(count, this.selectedRanks.length * 2)));
    }
    const bits = this.selectedRankBits!, groups = this.selectedRankWords!;
    for (let index = 0; index < count; index++) {
      const rank = this.lodIdToRank![selected[index]], word = rank >>> 5;
      bits[word] |= 1 << (rank & 31);
      groups[word >>> 5] |= 1 << (word & 31);
    }
    // The upper bitset skips invisible ranges; the lower one visits only the
    // selected IDs in paint order, including ties between LOD representatives.
    let out = 0;
    for (let group = 0; group < groups.length; group++) {
      let words = groups[group];
      groups[group] = 0;
      while (words !== 0) {
        const word = group * 32 + 31 - Math.clz32(words & -words);
        let selectedBits = bits[word];
        bits[word] = 0;
        while (selectedBits !== 0) {
          this.selectedRanks[out++] = word * 32 + 31 - Math.clz32(selectedBits & -selectedBits);
          selectedBits = (selectedBits & (selectedBits - 1)) >>> 0;
        }
        words = (words & (words - 1)) >>> 0;
      }
    }
    this.selectedRankCount = out;
  }

  private selectedRankOffset(rank: number): number {
    let low = 0, high = this.selectedRankCount;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.selectedRanks[middle] < rank) low = middle + 1;
      else high = middle;
    }
    return low;
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
    const profile = getThreeRenderPerformance();
    profile?.beginSection("three.batchRebuild");
    profile?.add("three.batchRebuilds");
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
    profile?.add("three.batchesCreated", this.entries.length);
    profile?.endSection("three.batchRebuild");
  }

  /** Whether the next scheduled paint submits as part of the batch being built. */
  private canBatch(previous: VectorDrawRun, previousIndex: number, next: VectorDrawRun, nextIndex: number, end: number): boolean {
    if (previous.kind !== next.kind || next.blendMode) return false;
    if (this.neighbours === null) return true;
    if (this.plan.segments && this.plan.spanOrdered) {
      return this.plan.segments[previousIndex] === this.plan.segments[nextIndex];
    }
    // Compositing keeps the canonical order and its transparency groups, so a
    // batch may only cover paints the graph lists next to each other, and the
    // compositor still addresses them as one contiguous instance range.
    return this.neighbours[previousIndex] === 1 && previous.clipIndex === next.clipIndex && end === next.first;
  }

  private range(run: VectorDrawRun, index: number, first = run.first, count = run.count): DrawRunRange {
    const allIds = this.idsByRun.get(index);
    const ids = allIds && (first === run.first && count === run.count
      ? allIds : allIds.filter(id => this.origins![id] >= first && this.origins![id] < first + count));
    return { run, index, first, count, ids, rankFirst: ids?.length ? this.lodIdToRank![ids[0]] : 0 };
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
      if (material !== this.parent.material) {
        getThreeRenderPerformance()?.add("three.materialsCreated");
        this.clipMaterials.set(key, material);
      }
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
    const profile = getThreeRenderPerformance();
    profile?.beginSection("three.batchUpdate");
    const redundancy = this.strokeRedundancy;
    if (redundancy && this.strokeCandidates && this.strokeRedundancyEnabled) {
      let count = 0, candidates = this.strokeCandidates;
      for (const entry of this.entries) {
        for (const range of entry.ranges) {
          if (!this.visibility.isRunVisible(range.run)) continue;
          const end = range.first + range.count;
          for (let id = range.first; id < end; id++) {
            if (!this.visibleIds[id] || !redundancy.isCandidate(id)) continue;
            // Overlapping runs can list an ID twice; update() counts it once.
            if (count === candidates.length) {
              const grown = new Uint32Array(count * 2 + 16);
              grown.set(candidates);
              candidates = this.strokeCandidates = grown;
            }
            candidates[count++] = id;
          }
        }
      }
      redundancy.update(candidates, count);
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
        const sparse = range.ids !== undefined && this.lodIdToRank !== null;
        const text = this.textSelection;
        let first = sparse ? this.selectedRankOffset(range.rankFirst) : 0;
        let end = sparse ? this.selectedRankOffset(range.rankFirst + range.ids!.length) : range.count;
        if (text) {
          first = text.ranges[range.index * 2];
          end = first + text.ranges[range.index * 2 + 1];
          // Multiply stays exact and expands to two passes per glyph. Search
          // its selected IDs instead of scanning the whole paint for each pass.
          if (range.first !== range.run.first || range.count !== range.run.count) {
            first = lowerBound(text.instanceIds, first, end, range.first);
            end = lowerBound(text.instanceIds, first, end, range.first + range.count);
          }
        }
        const ids = entry.idValues, clips = entry.clipValues;
        profile?.add("three.batchCandidateInstances", end - first);
        for (let item = first; item < end; item++) {
          const rangeIndex = sparse ? this.selectedRanks[item] - range.rankFirst : item;
          const id = text ? text.instanceIds[item] : range.ids ? range.ids[rangeIndex] : range.first + rangeIndex;
          if (!text && !this.visibleIds[id]) continue;
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
    profile?.endSection("three.batchUpdate");
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
    // Remove newest children first, avoiding shifts through every remaining
    // batch on each splice while preserving unrelated children and events.
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index];
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
  getThreeRenderPerformance()?.add("three.instanceUploadBytes", count * attribute.itemSize * attribute.array.BYTES_PER_ELEMENT);
  attribute.clearUpdateRanges();
  if (count > 0) attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
}

function lowerBound(ids: Uint32Array, first: number, end: number, id: number): number {
  while (first < end) {
    const middle = (first + end) >>> 1;
    if (ids[middle] < id) first = middle + 1; else end = middle;
  }
  return first;
}
