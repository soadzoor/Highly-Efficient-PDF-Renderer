import { createThreeMultiplyMaterial } from "./threeVectorMultiply";
import { createThreeVectorClipMaterial } from "./threeVectorClips";
import * as THREE from "three";
import { createDefaultOptionalContentSnapshot, type OptionalContentSnapshot } from "./optionalContent";
import { ScenePaintVisibility } from "./scenePaintVisibility";
import { scenePaintRunNeighbours } from "./scenePaintGraph";
import { vectorDrawRunsShareSubmission } from "./vectorDrawOrder";
import { VectorStrokeRedundancy } from "./vectorStrokeRedundancy";
import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { HEPR_THREE_LAYER_ORDER_RASTER, HEPR_THREE_LAYER_ORDER_TEXT } from "./threeLayerOrder";

export function vectorDrawRunRenderOrder(index: number, count: number): number {
  return HEPR_THREE_LAYER_ORDER_RASTER +
    (HEPR_THREE_LAYER_ORDER_TEXT - HEPR_THREE_LAYER_ORDER_RASTER) * ((index + 1) / (count + 1));
}

/** Share material/textures and batch compatible paints without changing canonical ranges. */
export class ThreeVectorDrawRuns {
  private readonly entries: { mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
    first: number; count: number; ranges: readonly VectorDrawRun[]; ids: THREE.InstancedBufferAttribute }[] = [];
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
  private readonly parent: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  private readonly attribute: string;

  static create(scene: VectorScene, kind: VectorDrawRun["kind"],
    parent: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>, attribute: string): ThreeVectorDrawRuns | null {
    return scene.drawRuns ? new ThreeVectorDrawRuns(scene, kind, parent, attribute) : null;
  }

  private constructor(scene: VectorScene, kind: VectorDrawRun["kind"],
    parent: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>, attribute: string) {
    this.parent = parent;
    this.visibility = new ScenePaintVisibility(scene);
    this.snapshot = createDefaultOptionalContentSnapshot(scene);
    this.visibility.setVisibility(this.snapshot);
    this.attribute = attribute;
    const source = parent.geometry.getAttribute(attribute);
    this.visibleIds = new Uint8Array(source.count);
    this.strokeRedundancy = kind === "stroke" && !this.visibility.requiresCompositing
      ? new VectorStrokeRedundancy(scene) : null;
    this.strokeCandidates = this.strokeRedundancy ? new Uint32Array(source.count) : null;
    this.sourceCount = parent.geometry.instanceCount;
    const runs = scene.drawRuns!;
    const neighbours = this.visibility.requiresCompositing ? scenePaintRunNeighbours(scene) : null;
    const runIndices = new Map<VectorDrawRun, number>();
    runs.forEach((run, index) => runIndices.set(run, index));
    const create = (ranges: readonly VectorDrawRun[], first: number, count: number, order: number, pass?: 0 | 1): void => {
      const run = ranges[0];
      const geometry = new THREE.InstancedBufferGeometry();
      for (const [name, value] of Object.entries(parent.geometry.attributes)) {
        if (name !== attribute) geometry.setAttribute(name, value);
      }
      geometry.setIndex(parent.geometry.index);
      const ids = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
      ids.setUsage(THREE.StreamDrawUsage);
      geometry.setAttribute(attribute, ids);
      geometry.instanceCount = count;
      const key = `${run.clipIndex ?? -1}:${pass ?? "normal"}`;
      let material = this.clipMaterials.get(key);
      if (!material) {
        material = createThreeVectorClipMaterial(parent.material, run.clipIndex);
        if (pass !== undefined) {
          const clipped = material;
          material = createThreeMultiplyMaterial(clipped, pass);
          if (clipped !== parent.material) clipped.dispose();
        }
        if (material !== parent.material) this.clipMaterials.set(key, material);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.heprDrawRun = { ...run, first, count };
      // The canonical paints behind this mesh. A mesh with nothing left to draw
      // tells the compositor those paints are off screen, which is what lets it
      // drop the transparency groups that no longer contain anything.
      mesh.userData.heprDrawRunIndices = ranges.map(range => runIndices.get(range)!);
      mesh.userData.heprInstanceAttribute = attribute;
      mesh.frustumCulled = false;
      mesh.renderOrder = vectorDrawRunRenderOrder(order, scene.drawRuns!.length);
      parent.add(mesh);
      this.entries.push({ mesh, first, count, ranges, ids });
    };
    for (let index = 0; index < runs.length; index++) {
      const run = runs[index];
      if (run.kind !== kind) continue;
      if (!scene.paintGraph && run.blendMode === "Multiply") {
        for (let item = 0; item < run.count; item++) {
          create([run], run.first + item, 1, index + item / run.count, 0);
          create([run], run.first + item, 1, index + (item + 0.5) / run.count, 1);
        }
      } else {
        const firstIndex = index, ranges = [run];
        let count = run.count;
        // Render-only batching removes OCG boundaries from draw submissions.
        // Canonical ranges remain separate for inspection and visibility. Real
        // graph groups and non-normal blends keep their original pass boundaries.
        // A composited scene merges too, but only across paints the graph keeps
        // side by side, so one mesh never straddles a group or reorders a paint.
        // A span that then covers only part of a mesh still renders that subset.
        if (!run.blendMode) {
          while (index + 1 < runs.length) {
            if (neighbours !== null && !neighbours[index]) break;
            const next = runs[index + 1];
            if (!vectorDrawRunsShareSubmission({ ...run, count }, next)) break;
            ranges.push(next); count += next.count; index++;
          }
        }
        create(ranges, run.first, count, firstIndex);
      }
    }
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
    if (source.version === this.sourceVersion && count === this.sourceCount) return;
    // Spatial culling can repack the same IDs in a different order. The ordered
    // batches only depend on membership, so reuse their buffers and redundancy
    // decision when no primitive actually entered or left the candidate set.
    let unchanged = this.sourceVersion >= 0 && count === this.sourceCount;
    if (unchanged) {
      for (let i = 0; i < count; i++) {
        if (!this.visibleIds[source.getX(i)]) { unchanged = false; break; }
      }
    }
    this.sourceVersion = source.version;
    this.sourceCount = count;
    if (unchanged) return;
    this.visibleIds.fill(0);
    for (let i = 0; i < count; i++) this.visibleIds[source.getX(i)] = 1;
    this.updateEntries();
  }

  private updateEntries(): void {
    if (this.strokeRedundancy && this.strokeCandidates && this.strokeRedundancyEnabled) {
      let count = 0;
      for (const entry of this.entries) {
        for (const range of entry.ranges) {
          if (!this.visibility.isRunVisible(range)) continue;
          const end = Math.min(range.first + range.count, entry.first + entry.count);
          for (let id = Math.max(range.first, entry.first); id < end; id++) {
            if (this.visibleIds[id]) this.strokeCandidates[count++] = id;
          }
        }
      }
      this.strokeRedundancy.update(this.strokeCandidates, count);
    }
    for (const entry of this.entries) {
      let visible = 0;
      let changed = false;
      for (const range of entry.ranges) {
        if (this.visibility.requiresCompositing
          ? range.optionalContent !== undefined && this.snapshot.conditions[range.optionalContent] === 0
          : !this.visibility.isRunVisible(range)) continue;
        const end = Math.min(range.first + range.count, entry.first + entry.count);
        for (let id = Math.max(range.first, entry.first); id < end; id++) {
          if (!this.visibleIds[id]) continue;
          if (this.strokeRedundancyEnabled && this.strokeRedundancy && !this.strokeRedundancy.isRetained(id)) continue;
          if (entry.ids.getX(visible) !== id) { entry.ids.setX(visible, id); changed = true; }
          visible++;
        }
      }
      entry.mesh.geometry.instanceCount = visible;
      entry.mesh.visible = this.enabled && visible > 0;
      if (changed) {
        entry.ids.clearUpdateRanges();
        if (visible > 0) entry.ids.addUpdateRange(0, visible);
        entry.ids.needsUpdate = true;
      }
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
    for (const material of this.clipMaterials.values()) material.dispose();
    this.clipMaterials.clear();
    for (const entry of this.entries) {
      this.parent.remove(entry.mesh);
      entry.mesh.geometry.dispose();
    }
  }
}
