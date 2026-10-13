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

const drawRunsByParent = new WeakMap<THREE.Object3D, ThreeVectorDrawRuns>();
/** Shared, so a replacement layer on the same parent never repeats a revision. */
let revisions = 0;

/**
 * Changes whenever the batches under `parent` change their membership,
 * visibility or instance data; undefined for other objects. Lets consumers
 * reuse what they derived from thousands of batch meshes on unchanged frames.
 */
export function threeVectorDrawRunsRevision(parent: THREE.Object3D): number | undefined {
  return drawRunsByParent.get(parent)?.revision;
}

/** The batches whose meshes are `parent`'s children, if any. */
export function threeVectorDrawRunsOf(parent: THREE.Object3D): ThreeVectorDrawRuns | undefined {
  return drawRunsByParent.get(parent);
}

/** The visible records of the levels of a stored Vector LOD. */
export interface StoredVectorLodSelection {
  readonly levels: readonly { readonly visibleSegmentIds: Uint32Array; readonly visibleSegmentCount: number }[];
  /** Storage IDs of each level's records; null levels use `bases[level] + id`. */
  readonly records: readonly (Uint32Array | null)[];
  readonly bases: readonly number[];
}

/**
 * Batch meshes have identity local transforms, so their world matrix is the
 * parent's. Three recomputes every descendant's matrices each frame; with
 * thousands of batches that dominates CPU time. Copy the parent's world matrix
 * only when it moves or batches are added, and update any other child as Three
 * would.
 */
function installBatchMatrixPropagation(parent: THREE.Object3D): void {
  if (drawRunsByParent.has(parent)) return;
  const propagated = new THREE.Matrix4();
  let valid = false, added = true;
  let others = parent.children.reduce((count, child) => count + (isStaticBatch(child) ? 0 : 1), 0);
  parent.addEventListener("childadded", ({ child }) => { added = true; if (!isStaticBatch(child)) others++; });
  parent.addEventListener("childremoved", ({ child }) => { if (!isStaticBatch(child)) others--; });
  parent.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean): void {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix);
        else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    const moved = !valid || !propagated.equals(this.matrixWorld);
    if (!moved && !added && others === 0) return;
    if (moved) { propagated.copy(this.matrixWorld); valid = true; }
    added = false;
    for (const child of this.children) {
      if (isStaticBatch(child)) {
        if ((moved || child.matrixWorldNeedsUpdate) && child.matrixWorldAutoUpdate) {
          child.matrixWorld.multiplyMatrices(this.matrixWorld, child.matrix);
        }
        child.matrixWorldNeedsUpdate = false;
      } else child.updateMatrixWorld(force);
    }
  };
}

function isStaticBatch(object: THREE.Object3D): boolean {
  return object.userData.heprStaticBatch === true && !object.matrixAutoUpdate && object.children.length === 0;
}

/** A canonical paint range, or the single instance a Multiply pass expands to. */
interface DrawRunRange {
  run: VectorDrawRun;
  index: number;
  first: number;
  count: number;
  ids?: Uint32Array;
  /**
   * The range's selection keys, [keyFirst, keyEnd): canonical IDs, or for
   * stored LOD records their static paint ranks (`ids` in rank order).
   */
  keyFirst: number;
  keyEnd: number;
  /** This update's slice of the sorted selected keys. */
  selectionFirst: number;
  selectionEnd: number;
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
  /** Source instance capacity: the selection never exceeds it. */
  private readonly selectionCapacity: number;
  private readonly strokeRedundancy: VectorStrokeRedundancy | null;
  /** Visible IDs that may be culled; only strokes sharing a line qualify. */
  private strokeCandidates: Uint32Array | null;
  private strokeRedundancyEnabled = true;
  private sourceCount: number;
  private sourceVersion = -1;
  private enabled = true;
  /** Whether every batch's visibility already reflects `enabled` and its instances. */
  private visibilityApplied = false;
  private renderedCount = 0;
  /** See threeVectorDrawRunsRevision. */
  revision = ++revisions;
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
  /** Two-level bitset that sorts the selected keys without scanning every paint. */
  private readonly selectedKeyBits: Uint32Array;
  private readonly selectedKeyWords: Uint32Array;
  private selectedKeys = new Uint32Array(0);
  private selectedKeyCount = 0;
  /** Receives the next sorted selection, so an unchanged one is detected by comparison. */
  private nextKeys = new Uint32Array(0);
  /** Whether the batches reflect the current selection; rebuilt batches do not yet. */
  private entriesCurrent = false;
  /** Every range once, ordered by keyFirst, for one merge with the selected keys. */
  private rangesByKey: DrawRunRange[] = [];
  private textSelection: OrderedTextLodSelection | null = null;
  private textSelectionRevision = -1;
  /** See deferInstanceWrites. */
  private instanceWritesDeferred = false;
  /** Whether batch IDs lag the selection because their writes were deferred. */
  private instanceIdsStale = false;
  private readonly entryByMesh = new Map<THREE.Object3D, DrawRunEntry>();

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
    installBatchMatrixPropagation(parent);
    drawRunsByParent.set(parent, this);
    this.visibility = new ScenePaintVisibility(scene);
    this.snapshot = createDefaultOptionalContentSnapshot(scene);
    this.visibility.setVisibility(this.snapshot);
    const source = parent.geometry.getAttribute(attribute);
    this.selectionCapacity = source.count;
    this.selectedKeyBits = new Uint32Array(Math.ceil(source.count / 32));
    this.selectedKeyWords = new Uint32Array(Math.ceil(this.selectedKeyBits.length / 32));
    this.strokeRedundancy = kind === "stroke" && !origins && !this.visibility.requiresCompositing
      ? new VectorStrokeRedundancy(scene) : null;
    this.strokeCandidates = this.strokeRedundancy ? new Uint32Array(this.strokeRedundancy.candidateCount) : null;
    this.sourceCount = parent.geometry.instanceCount;
    this.neighbours = this.visibility.requiresCompositing ? scenePaintRunNeighbours(scene) : null;
    this.plan = plan ?? getThreeVectorDrawPlan(scene);
    if (origins) {
      this.lodIdToRank = new Uint32Array(source.count);
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
    const sourceChanged = source.version !== this.sourceVersion || count !== this.sourceCount;
    if (!replanned && !sourceChanged) return;
    // Spatial culling can repack the same IDs in a different order. The ordered
    // batches only depend on membership, so reuse their buffers and redundancy
    // decision when no primitive actually entered or left the candidate set.
    // A replan with the same source keeps the selection, which may have come
    // from updateStoredSelection rather than the source attribute.
    let changed = false;
    if (sourceChanged) {
      this.sourceVersion = source.version;
      this.sourceCount = count;
      const selected = source.array as Float32Array, ranks = this.lodIdToRank;
      for (let index = 0; index < count; index++) this.markSelectedKey(ranks ? ranks[selected[index]] : selected[index]);
      changed = this.takeSelectedKeys(count);
    }
    if (!changed && this.entriesCurrent) return;
    this.updateEntries();
  }

  /**
   * Select stored LOD records straight from their levels' visible lists, as
   * the native ordered batches do: one pass to paint-order ranks, which also
   * deduplicate records that several levels share. Returns the selected count.
   */
  updateStoredSelection(selection: StoredVectorLodSelection): number {
    const ranks = this.lodIdToRank;
    if (!ranks) throw new Error("Stored LOD selection requires stored-record origins.");
    // This selection supersedes the source attribute's. Record that attribute
    // as seen, or the next unchanged frame would read its stale IDs (all
    // records, until something writes it) as a new selection.
    this.sourceVersion = (this.parent.geometry.getAttribute(this.attribute) as THREE.InstancedBufferAttribute).version;
    this.parent.geometry.instanceCount = 0;
    if (this.plan.version !== this.planVersion) this.rebuildEntries();
    let count = 0;
    selection.levels.forEach((level, index) => {
      const records = selection.records[index], base = selection.bases[index];
      const ids = level.visibleSegmentIds;
      count += level.visibleSegmentCount;
      if (records) {
        for (let item = 0; item < level.visibleSegmentCount; item++) this.markSelectedKey(ranks[records[ids[item]]]);
      } else {
        for (let item = 0; item < level.visibleSegmentCount; item++) this.markSelectedKey(ranks[base + ids[item]]);
      }
    });
    if ((this.takeSelectedKeys(count) || !this.entriesCurrent) && !this.textSelection) this.updateEntries();
    return this.selectedKeyCount;
  }

  /**
   * While the mixed vector layer draws these batches, it reads their instances
   * through writeMixedInstances and they are never drawn themselves. Updates
   * then keep each batch's count and visibility but skip writing its IDs.
   * Ending the deferral writes any that lag the selection, before any draw.
   */
  deferInstanceWrites(deferred: boolean): void {
    // Text has its own selection and is never mixed.
    deferred &&= !this.textSelection;
    if (deferred === this.instanceWritesDeferred) return;
    this.instanceWritesDeferred = deferred;
    if (!deferred && this.instanceIdsStale) this.updateEntries();
  }

  get deferredInstanceWrites(): boolean {
    return this.instanceWritesDeferred;
  }

  /**
   * Write `mesh`'s selected instances as mixed records (ID, clip code, kind,
   * page) from `offset`, exactly as its own buffers would list them. Returns
   * the offset after them.
   */
  writeMixedInstances(mesh: THREE.Object3D, values: Float32Array, offset: number, kind: number,
    pages: ArrayLike<number> | undefined): number {
    const entry = this.entryByMesh.get(mesh);
    if (!entry) return offset;
    const keys = this.selectedKeys;
    const redundancy = this.strokeRedundancyEnabled ? this.strokeRedundancy : null;
    for (const range of entry.ranges) {
      if (range.selectionEnd === range.selectionFirst || !this.rangeVisible(range)) continue;
      const clipCode = (range.run.clipIndex ?? -1) + 1;
      const stored = this.lodIdToRank !== null ? range.ids : undefined;
      for (let item = range.selectionFirst; item < range.selectionEnd; item++) {
        const id = stored ? stored[keys[item] - range.keyFirst] : keys[item];
        if (redundancy && !redundancy.isRetained(id)) continue;
        values[offset++] = id;
        values[offset++] = clipCode;
        values[offset++] = kind;
        values[offset++] = pages?.[id] ?? 0;
      }
    }
    return offset;
  }

  /** Add one key (canonical ID or stored-record rank) to the next selection. */
  private markSelectedKey(key: number): void {
    const word = key >>> 5;
    this.selectedKeyBits[word] |= 1 << (key & 31);
    this.selectedKeyWords[word >>> 5] |= 1 << (word & 31);
  }

  /**
   * Sort the marked keys into paint order without scanning every paint, and
   * clear the marks. `marked` bounds their number. Returns whether the
   * selection changed.
   */
  private takeSelectedKeys(marked: number): boolean {
    if (this.nextKeys.length < marked) {
      this.nextKeys = new Uint32Array(Math.min(this.selectionCapacity, Math.max(marked, this.nextKeys.length * 2)));
    }
    const next = this.nextKeys, bits = this.selectedKeyBits, groups = this.selectedKeyWords;
    // The upper bitset skips invisible ranges; the lower one visits only the
    // selected keys in paint order, including ties between LOD representatives.
    let out = 0;
    for (let group = 0; group < groups.length; group++) {
      let words = groups[group];
      groups[group] = 0;
      while (words !== 0) {
        const word = group * 32 + 31 - Math.clz32(words & -words);
        let selectedBits = bits[word];
        bits[word] = 0;
        while (selectedBits !== 0) {
          next[out++] = word * 32 + 31 - Math.clz32(selectedBits & -selectedBits);
          selectedBits = (selectedBits & (selectedBits - 1)) >>> 0;
        }
        words = (words & (words - 1)) >>> 0;
      }
    }
    let changed = out !== this.selectedKeyCount;
    for (let index = 0; !changed && index < out; index++) changed = next[index] !== this.selectedKeys[index];
    if (!changed) return false;
    this.nextKeys = this.selectedKeys;
    this.selectedKeys = next;
    this.selectedKeyCount = out;
    return true;
  }

  /**
   * Give every range its slice of the sorted selected keys in one merge, so an
   * update costs the ranges plus the selection rather than every paint.
   */
  private assignSelectionSlices(): void {
    const keys = this.selectedKeys, count = this.selectedKeyCount;
    let start = 0;
    for (const range of this.rangesByKey) {
      while (start < count && keys[start] < range.keyFirst) start++;
      let end = start;
      while (end < count && keys[end] < range.keyEnd) end++;
      range.selectionFirst = start;
      range.selectionEnd = end;
    }
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
    // Multiply passes share their range; slice each range once.
    this.rangesByKey = [...new Set(this.entries.flatMap(entry => entry.ranges))]
      .sort((a, b) => a.keyFirst - b.keyFirst);
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
    // Stored records of one paint have consecutive ranks, ordered by origin;
    // a paint without stored records selects nothing.
    const keyFirst = this.lodIdToRank ? (ids?.length ? this.lodIdToRank[ids[0]] : 0) : first;
    const keyEnd = this.lodIdToRank ? keyFirst + (ids?.length ?? 0) : first + count;
    return { run, index, first, count, ids, keyFirst, keyEnd, selectionFirst: 0, selectionEnd: 0 };
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
    // The parent propagates its world matrix; see installBatchMatrixPropagation.
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldNeedsUpdate = true;
    mesh.userData.heprStaticBatch = true;
    mesh.renderOrder = vectorDrawRunRenderOrder(order, this.scene.drawRuns!.length);
    this.parent.add(mesh);
    const entry = { mesh, ranges, ids, idValues: ids.array as Float32Array,
      clipCodes, clipValues: (clipCodes?.array as Float32Array | undefined) ?? null };
    this.entries.push(entry);
    this.entryByMesh.set(mesh, entry);
    this.visibilityApplied = false;
    this.entriesCurrent = false;
    this.revision = ++revisions;
  }

  private updateEntries(): void {
    const profile = getThreeRenderPerformance();
    profile?.beginSection("three.batchUpdate");
    const text = this.textSelection;
    if (!text) this.assignSelectionSlices();
    const keys = this.selectedKeys;
    const redundancy = this.strokeRedundancy;
    if (redundancy && this.strokeCandidates && this.strokeRedundancyEnabled) {
      let count = 0, candidates = this.strokeCandidates;
      for (const entry of this.entries) {
        for (const range of entry.ranges) {
          if (!this.visibility.isRunVisible(range.run)) continue;
          // Redundancy applies to canonical strokes only, whose keys are IDs.
          for (let item = range.selectionFirst; item < range.selectionEnd; item++) {
            const id = keys[item];
            if (!redundancy.isCandidate(id)) continue;
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
    // Deferred batches keep counts and visibility; writeMixedInstances lists their IDs.
    const deferred = this.instanceWritesDeferred && !text;
    let modified = deferred, rendered = 0, considered = 0;
    for (const entry of this.entries) {
      let visible = 0;
      let changed = false;
      let clipsChanged = false;
      for (const range of entry.ranges) {
        if (!text && range.selectionEnd === range.selectionFirst) continue;
        if (!this.rangeVisible(range)) continue;
        if (deferred) {
          // Redundant strokes are dropped per ID; count them as the writer will.
          const redundancy = this.strokeRedundancyEnabled ? this.strokeRedundancy : null;
          if (!redundancy) visible += range.selectionEnd - range.selectionFirst;
          else for (let item = range.selectionFirst; item < range.selectionEnd; item++) {
            if (redundancy.isRetained(keys[item])) visible++;
          }
          continue;
        }
        const clipCode = (range.run.clipIndex ?? -1) + 1;
        const stored = this.lodIdToRank !== null ? range.ids : undefined;
        let first = range.selectionFirst;
        let end = range.selectionEnd;
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
        considered += end - first;
        for (let item = first; item < end; item++) {
          const id = text ? text.instanceIds[item] : stored ? stored[keys[item] - range.keyFirst] : keys[item];
          if (this.strokeRedundancyEnabled && this.strokeRedundancy && !this.strokeRedundancy.isRetained(id)) continue;
          if (ids[visible] !== id) { ids[visible] = id; changed = true; }
          if (clips && clips[visible] !== clipCode) { clips[visible] = clipCode; clipsChanged = true; }
          visible++;
        }
      }
      if (deferred) considered += visible;
      const shown = this.enabled && visible > 0;
      if (changed || clipsChanged || entry.mesh.geometry.instanceCount !== visible || entry.mesh.visible !== shown) modified = true;
      entry.mesh.geometry.instanceCount = visible;
      entry.mesh.visible = shown;
      if (shown) rendered += visible;
      if (changed) markInstanceUpdate(entry.ids, visible);
      if (clipsChanged && entry.clipCodes) markInstanceUpdate(entry.clipCodes, visible);
    }
    this.instanceIdsStale = deferred;
    this.renderedCount = rendered;
    this.visibilityApplied = true;
    this.entriesCurrent = true;
    if (modified) this.revision = ++revisions;
    profile?.add("three.batchCandidateInstances", considered);
    profile?.endSection("three.batchUpdate");
  }

  /** Whether optional content shows a paint range's instances. */
  private rangeVisible(range: DrawRunRange): boolean {
    return this.visibility.requiresCompositing
      ? range.run.optionalContent === undefined || this.snapshot.conditions[range.run.optionalContent] !== 0
      : this.visibility.isRunVisible(range.run);
  }

  setEnabled(enabled: boolean): void {
    // Stroke LOD layers call this every frame; an unchanged state is already applied.
    if (enabled === this.enabled && this.visibilityApplied) return;
    this.enabled = enabled;
    let rendered = 0;
    for (const entry of this.entries) {
      const count = entry.mesh.geometry.instanceCount;
      entry.mesh.visible = enabled && count > 0;
      if (entry.mesh.visible) rendered += count;
    }
    this.renderedCount = rendered;
    this.visibilityApplied = true;
    this.revision = ++revisions;
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

  /** Instances this layer's own selection submits, before any mixed-batch substitution. */
  getRenderedCount(): number {
    return this.visibilityApplied ? this.renderedCount
      : this.entries.reduce((count, entry) => count + (entry.mesh.visible ? entry.mesh.geometry.instanceCount : 0), 0);
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
    this.entryByMesh.clear();
    this.visibilityApplied = false;
    this.revision = ++revisions;
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
