import type { VectorScene } from "./pdfVectorExtractor";
import { MAX_OPTIONAL_CONTENT_CONDITIONS, MAX_OPTIONAL_CONTENT_GROUPS, type OptionalContentGroup, type OptionalContentOrderNode,
  type SceneOptionalContent } from "./optionalContentData";
import { waitForLoad } from "./loadCancellation";
import { isAnnotationLayer } from "./annotationLayers";

export interface LayerVisibilityChange { readonly id: string; readonly visible: boolean }
export interface LayerVisibilitySummary {
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly disabled: boolean;
}
export interface OptionalContentLayer extends OptionalContentGroup { readonly visible: boolean }
/** Runtime visibility of one compiled annotation appearance. */
export interface AnnotationLayerVisibility { readonly annotationId: string; readonly visible: boolean }
/** A detached visibility snapshot. Treat its condition bytes as read-only. */
export interface OptionalContentSnapshot {
  /** Internal viewing alternatives, independent of the document's PDF layer conditions. */
  readonly rasterPages?: ReadonlySet<number>;
  readonly revision: number;
  readonly layers: readonly LayerVisibilityChange[];
  readonly conditions: Uint8Array;
}
export type OptionalContentListener = (snapshot: OptionalContentSnapshot) => void;
export interface OptionalContentUpdateOptions { readonly signal?: AbortSignal }
export interface OptionalContentControllerOptions {
  /** Prepare replacement resources without presenting them; return an atomic commit callback. */
  readonly prepare?: (snapshot: OptionalContentSnapshot, options: {
    readonly signal: AbortSignal;
    readonly onProgress: (percentage: number | null) => void;
  }) => Promise<(() => void) | void>;
  readonly onProgress?: (percentage: number | null) => void;
  readonly onChange?: OptionalContentListener;
}

const MAX_GROUPS = MAX_OPTIONAL_CONTENT_GROUPS;
const MAX_CONDITIONS = MAX_OPTIONAL_CONTENT_CONDITIONS;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalid(message: string): never { throw new TypeError(`Invalid optional content: ${message}.`); }

/** Validate the serialized data before it can participate in rendering or queries. */
export function validateSceneOptionalContent(value: unknown): asserts value is SceneOptionalContent {
  if (!record(value) || !Array.isArray(value.groups) || !Array.isArray(value.conditions) ||
      !Array.isArray(value.order) || !Array.isArray(value.radioGroups)) invalid("expected layer tables");
  if (value.groups.length > MAX_GROUPS || value.conditions.length > MAX_CONDITIONS) invalid("table limit exceeded");
  const ids = new Set<string>();
  for (const group of value.groups) {
    if (!record(group) || typeof group.id !== "string" || !group.id || ids.has(group.id) ||
        typeof group.name !== "string" || typeof group.defaultVisible !== "boolean" ||
        typeof group.locked !== "boolean" || typeof group.usedInView !== "boolean" ||
        (group.annotationId !== undefined && (typeof group.annotationId !== "string" || !group.annotationId))) invalid("invalid or duplicate layer");
    ids.add(group.id);
  }
  const conditions = value.conditions;
  const validIndex = (index: unknown): index is number => typeof index === "number" &&
    Number.isSafeInteger(index) && index >= 0 && index < conditions.length;
  for (const condition of conditions) {
    if (!record(condition)) invalid("invalid condition");
    if (condition.kind === "group") {
      if (typeof condition.groupId !== "string" || !ids.has(condition.groupId)) invalid("unknown condition layer");
    } else if (condition.kind === "constant") {
      if (typeof condition.value !== "boolean") invalid("invalid constant condition");
    } else if (condition.kind === "not") {
      if (!validIndex(condition.operand)) invalid("invalid condition reference");
    } else if (condition.kind === "and" || condition.kind === "or") {
      if (!Array.isArray(condition.operands) || !condition.operands.every(validIndex)) invalid("invalid condition operands");
    } else invalid("unknown condition kind");
  }
  const visited = new Uint8Array(conditions.length);
  const indices: number[] = [], children: number[] = [];
  for (let root = 0; root < conditions.length; root++) {
    if (visited[root]) continue;
    indices.push(root); children.push(0); visited[root] = 1;
    while (indices.length) {
      const top = indices.length - 1, index = indices[top], condition = conditions[index];
      const operands = condition.kind === "not" ? [condition.operand] :
        condition.kind === "and" || condition.kind === "or" ? condition.operands : [];
      if (children[top] >= operands.length) {
        visited[index] = 2; indices.pop(); children.pop();
        continue;
      }
      const child = operands[children[top]++];
      if (visited[child] === 1) invalid("cyclic condition");
      if (!visited[child]) { indices.push(child); children.push(0); visited[child] = 1; }
    }
  }
  const orderArrays: unknown[][] = [value.order], orderChildren = [0];
  const activeOrder = new Set<unknown[]>(orderArrays);
  while (orderArrays.length) {
    const top = orderArrays.length - 1, nodes = orderArrays[top];
    if (orderChildren[top] >= nodes.length) {
      activeOrder.delete(nodes); orderArrays.pop(); orderChildren.pop();
    } else {
      const node = nodes[orderChildren[top]++];
      if (!record(node)) invalid("invalid layer order");
      if (node.kind === "group") {
        if (typeof node.groupId !== "string" || !ids.has(node.groupId)) invalid("unknown ordered layer");
      } else if (node.kind !== "label" || typeof node.label !== "string" || !Array.isArray(node.children)) invalid("invalid layer order node");
      if (node.children !== undefined) {
        if (!Array.isArray(node.children)) invalid("invalid layer order children");
        if (activeOrder.has(node.children)) invalid("cyclic layer order");
        orderArrays.push(node.children); orderChildren.push(0); activeOrder.add(node.children);
      }
    }
  }
  for (const radio of value.radioGroups) {
    if (!Array.isArray(radio) || radio.some(id => typeof id !== "string" || !ids.has(id)) ||
        new Set(radio).size !== radio.length) invalid("invalid radio group");
  }
}

export function validateSceneOptionalContentReferences(scene: VectorScene): void {
  if (scene.optionalContent !== undefined) validateSceneOptionalContent(scene.optionalContent);
  for (const run of scene.drawRuns ?? []) {
    if (run.optionalContent !== undefined && (!Number.isSafeInteger(run.optionalContent) ||
        run.optionalContent < 0 || run.optionalContent >= (scene.optionalContent?.conditions.length ?? 0))) {
      invalid("draw run references an unknown condition");
    }
  }
  for (const page of scene.textIndex?.pages ?? []) {
    if (page.optionalContent === undefined) continue;
    if (!(page.optionalContent instanceof Int32Array) || page.optionalContent.length !== page.text.length ||
        page.optionalContent.length !== page.charInstance.length || page.optionalContent.some(index =>
          index < -1 || index >= (scene.optionalContent?.conditions.length ?? 0))) invalid("invalid text condition references");
  }
}

function evaluate(data: SceneOptionalContent | undefined, values: ReadonlyMap<string, boolean>): Uint8Array {
  if (!data) return new Uint8Array(0);
  const result = new Uint8Array(data.conditions.length);
  const visited = new Uint8Array(result.length);
  const indices: number[] = [], children: number[] = [];
  for (let root = 0; root < result.length; root++) {
    if (visited[root]) continue;
    indices.push(root); children.push(0);
    while (indices.length) {
      const top = indices.length - 1, index = indices[top], condition = data.conditions[index];
      const operands = condition.kind === "not" ? [condition.operand] :
        condition.kind === "and" || condition.kind === "or" ? condition.operands : [];
      if (children[top] < operands.length) {
        const child = operands[children[top]++];
        if (!visited[child]) { indices.push(child); children.push(0); }
        continue;
      }
      const visible = condition.kind === "group" ? values.get(condition.groupId) === true :
        condition.kind === "constant" ? condition.value : condition.kind === "not" ? result[condition.operand] === 0 :
          condition.kind === "and" ? condition.operands.every(child => result[child] !== 0) :
            condition.operands.some(child => result[child] !== 0);
      result[index] = visible ? 1 : 0; visited[index] = 1;
      indices.pop(); children.pop();
    }
  }
  return result;
}

function snapshot(data: SceneOptionalContent | undefined, values: ReadonlyMap<string, boolean>, revision: number): OptionalContentSnapshot {
  return { revision, layers: (data?.groups ?? []).map(group => ({ id: group.id, visible: values.get(group.id) === true })),
    conditions: evaluate(data, values) };
}

async function evaluateCooperatively(data: SceneOptionalContent, values: ReadonlyMap<string, boolean>, signal: AbortSignal): Promise<Uint8Array> {
  const result = new Uint8Array(data.conditions.length), done = new Uint8Array(result.length);
  const indices: number[] = [], children: number[] = [], accumulated: boolean[] = [];
  let operations = 0, lastYield = performance.now();
  for (let index = 0; index < result.length; index++) {
    if (done[index]) continue;
    indices.push(index); children.push(0); accumulated.push(false);
    while (indices.length) {
      signal.throwIfAborted();
      const depth = indices.length - 1, current = indices[depth], condition = data.conditions[current];
      let visible: boolean | undefined;
      if (condition.kind === "group") visible = values.get(condition.groupId) === true;
      else if (condition.kind === "constant") visible = condition.value;
      else {
        const operands = condition.kind === "not" ? [condition.operand] : condition.operands;
        const child = children[depth];
        if (child === 0) accumulated[depth] = condition.kind === "and";
        if (child < operands.length) {
          const operand = operands[child];
          if (!done[operand]) { indices.push(operand); children.push(0); accumulated.push(false); }
          else {
            accumulated[depth] = condition.kind === "not" ? result[operand] === 0 :
              condition.kind === "and" ? accumulated[depth] && result[operand] !== 0 : accumulated[depth] || result[operand] !== 0;
            children[depth]++;
          }
        } else visible = accumulated[depth];
      }
      if (visible !== undefined) {
        result[current] = visible ? 1 : 0; done[current] = 1;
        indices.pop(); children.pop(); accumulated.pop();
      }
      if (++operations % 1024 === 0 && performance.now() - lastYield >= 8) {
        await waitForLoad(new Promise<void>(resolve => setTimeout(resolve, 0)), signal);
        lastYield = performance.now();
      }
    }
  }
  return result;
}
function cloneSnapshot(value: OptionalContentSnapshot): OptionalContentSnapshot {
  return { revision: value.revision, layers: value.layers.map(layer => ({ ...layer })), conditions: value.conditions.slice() };
}

function cloneOrder(nodes: readonly OptionalContentOrderNode[]): OptionalContentOrderNode[] {
  const result: OptionalContentOrderNode[] = [];
  const pending = [{ source: nodes, target: result }];
  while (pending.length) {
    const { source, target } = pending.pop()!;
    for (const node of source) {
      const copy = { ...node };
      if (node.children) {
        const children: OptionalContentOrderNode[] = [];
        copy.children = children;
        pending.push({ source: node.children, target: children });
      }
      target.push(copy);
    }
  }
  return result;
}

export function createDefaultOptionalContentSnapshot(scene: VectorScene): OptionalContentSnapshot {
  validateSceneOptionalContentReferences(scene);
  return snapshot(scene.optionalContent, new Map(scene.optionalContent?.groups.map(group => [group.id, group.defaultVisible])), 0);
}

/** Interaction-only snapshot: reveal annotation appearances without changing PDF layers or rendering. */
export function createAnnotationInteractionSnapshot(scene: VectorScene, applied: OptionalContentSnapshot): OptionalContentSnapshot {
  const values = new Map(applied.layers.map(layer => [layer.id, layer.visible]));
  for (const group of scene.optionalContent?.groups ?? []) if (isAnnotationLayer(group)) values.set(group.id, true);
  return snapshot(scene.optionalContent, values, applied.revision);
}

const annotationLayerIds = new WeakMap<SceneOptionalContent, ReadonlyMap<string, string>>();
/** Annotation layer id to annotation id, for scenes compiled with annotation layers. */
export function getAnnotationLayerIds(data: SceneOptionalContent | undefined): ReadonlyMap<string, string> {
  if (!data) return new Map();
  let ids = annotationLayerIds.get(data);
  if (!ids) {
    ids = new Map(data.groups.filter(isAnnotationLayer).map(group => [group.id, group.annotationId!]));
    annotationLayerIds.set(data, ids);
  }
  return ids;
}

/** All OCGs referenced by a condition, including negated groups and nested memberships. Annotation layers are not OCGs. */
export function getOptionalContentGroupIds(data: SceneOptionalContent | undefined, condition?: number): string[] {
  if (condition === undefined) return [];
  if (!data || !Number.isSafeInteger(condition) || condition < 0 || condition >= data.conditions.length) {
    throw new RangeError("Optional-content condition is outside the scene.");
  }
  const annotationLayers = getAnnotationLayerIds(data);
  const visited = new Set<number>(), groups = new Set<string>();
  const pending = [condition];
  while (pending.length) {
    const index = pending.pop()!;
    if (visited.has(index)) continue;
    visited.add(index);
    const item = data.conditions[index];
    if (item.kind === "group") { if (!annotationLayers.has(item.groupId)) groups.add(item.groupId); }
    else if (item.kind === "not") pending.push(item.operand);
    else if (item.kind === "and" || item.kind === "or") {
      for (let child = item.operands.length - 1; child >= 0; child--) pending.push(item.operands[child]);
    }
  }
  return [...groups];
}

/**
 * Per-view layer state; source definitions and default visibility remain unchanged.
 * PDF layers and HEPR annotation layers share one condition table but separate APIs.
 */
export class OptionalContentController {
  private data: SceneOptionalContent | undefined;
  /** PDF layers only. */
  private groups: Map<string, OptionalContentGroup>;
  /** Annotation id to its annotation layer id. */
  private annotationLayers: Map<string, string>;
  private annotationIds: ReadonlySet<string>;
  private readonly savedVisibility = new Map<string, boolean>();
  private readonly listeners = new Set<OptionalContentListener>();
  private readonly options: OptionalContentControllerOptions;
  private current: OptionalContentSnapshot;
  private requested: Map<string, boolean>;
  private active: AbortController | null = null;
  private generation = 0;
  private disposed = false;

  constructor(scene: VectorScene, options: OptionalContentControllerOptions = {}) {
    this.current = createDefaultOptionalContentSnapshot(scene);
    this.data = scene.optionalContent;
    this.groups = new Map(this.data?.groups.filter(group => !isAnnotationLayer(group)).map(group => [group.id, group]));
    this.annotationLayers = new Map([...getAnnotationLayerIds(this.data)].map(([layerId, annotationId]) => [annotationId, layerId]));
    this.annotationIds = new Set(scene.annotations?.map(annotation => annotation.id));
    this.requested = new Map(this.current.layers.map(layer => [layer.id, layer.visible]));
    this.options = options;
    if (options.onChange) this.listeners.add(options.onChange);
  }
  get revision(): number { return this.current.revision; }
  /** Refresh a demand-loaded scene without losing choices or subscriptions when pages are evicted. */
  async replaceScene(scene: VectorScene): Promise<void> {
    this.assertLive();
    for (const layer of this.current.layers) this.savedVisibility.set(layer.id, layer.visible);
    this.active?.abort(); this.active = null; this.generation++;
    const revision = this.current.revision;
    this.data = scene.optionalContent;
    this.groups = new Map(this.data?.groups.filter(group => !isAnnotationLayer(group)).map(group => [group.id, group]));
    this.annotationLayers = new Map([...getAnnotationLayerIds(this.data)].map(([id, annotationId]) => [annotationId, id]));
    this.annotationIds = new Set(scene.annotations?.map(annotation => annotation.id));
    this.current = { ...createDefaultOptionalContentSnapshot(scene), revision };
    this.requested = new Map(this.current.layers.map(layer => [layer.id, this.savedVisibility.get(layer.id) ?? layer.visible]));
    // New replay resources must be prepared even if the saved choices match their defaults.
    await this.update(this.requested, {}, true);
  }
  getLayers(): OptionalContentLayer[] {
    const values = new Map(this.current.layers.map(layer => [layer.id, layer.visible]));
    return [...this.groups.values()].map(group => ({ ...group, visible: values.get(group.id)! }));
  }
  getOrder(): readonly OptionalContentOrderNode[] { return cloneOrder(this.data?.order ?? []); }
  getSnapshot(): OptionalContentSnapshot { return cloneSnapshot(this.current); }
  isVisible(condition?: number): boolean { return condition === undefined || this.current.conditions[condition] === 1; }
  getGroupIds(condition?: number): string[] { return getOptionalContentGroupIds(this.data, condition); }
  subscribe(listener: OptionalContentListener): () => void {
    this.assertLive(); this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  setLayerVisibility(id: string, visible: boolean, options: OptionalContentUpdateOptions = {}): Promise<void> {
    return this.setLayerVisibilities([{ id, visible }], options);
  }
  resetLayerVisibility(options: OptionalContentUpdateOptions = {}): Promise<void> {
    // Annotation visibility is the host's own state and survives a layer reset.
    const next = new Map(this.requested);
    for (const group of this.groups.values()) next.set(group.id, group.defaultVisible);
    return this.update(next, options);
  }
  /** Annotations whose compiled appearance has its own runtime layer. */
  getAnnotationLayers(): AnnotationLayerVisibility[] {
    const applied = new Map(this.current.layers.map(layer => [layer.id, layer.visible]));
    return [...this.annotationLayers].map(([annotationId, layerId]) => ({ annotationId, visible: applied.get(layerId) === true }));
  }
  /**
   * Show or hide compiled annotation appearances. Metadata, bubbles and
   * annotation picking are unaffected. Annotations without an appearance
   * layer (popups, links, hidden or omitted appearances) are accepted and
   * ignored; ids not in the scene are rejected.
   */
  async setAnnotationVisibility(annotationIds: readonly string[], visible: boolean, options: OptionalContentUpdateOptions = {}): Promise<void> {
    this.assertLive(); options.signal?.throwIfAborted();
    if (!Array.isArray(annotationIds)) throw new TypeError("Annotation IDs must be an array.");
    if (typeof visible !== "boolean") throw new TypeError("Annotation visibility must be boolean.");
    const next = new Map(this.requested);
    for (const annotationId of annotationIds) {
      const layerId = this.annotationLayers.get(annotationId);
      if (layerId !== undefined) next.set(layerId, visible);
      else if (!this.annotationIds.has(annotationId)) throw new RangeError(`Unknown annotation: ${annotationId}`);
    }
    await this.update(next, options);
  }
  async setLayerVisibilities(changes: readonly LayerVisibilityChange[], options: OptionalContentUpdateOptions = {}): Promise<void> {
    this.assertLive(); options.signal?.throwIfAborted();
    if (!Array.isArray(changes)) throw new TypeError("Layer visibility changes must be an array.");
    const explicit = new Map<string, boolean>();
    for (const change of changes) {
      const group = change && this.groups.get(change.id);
      if (!group) throw new RangeError(`Unknown PDF layer: ${change?.id}`);
      if (typeof change.visible !== "boolean") throw new TypeError("Layer visibility must be boolean.");
      if ((group.locked || !group.usedInView) && change.visible !== group.defaultVisible) throw new Error(`PDF layer cannot be changed: ${group.name}`);
      if (explicit.has(change.id) && explicit.get(change.id) !== change.visible) throw new Error("Conflicting layer visibility changes.");
      explicit.set(change.id, change.visible);
    }
    const next = new Map(this.requested);
    for (const [id, visible] of explicit) next.set(id, visible);
    for (const radio of this.data?.radioGroups ?? []) {
      const enabled = radio.filter(id => explicit.get(id) === true);
      if (enabled.length > 1) throw new Error("Only one layer in a PDF radio group may be enabled.");
      if (enabled.length) for (const id of radio) if (id !== enabled[0] && next.get(id)) {
        const group = this.groups.get(id)!;
        if (group.locked || !group.usedInView) throw new Error(`PDF layer cannot be changed: ${group.name}`);
        next.set(id, false);
      }
    }
    await this.update(next, options);
  }
  /** Toggle editable targets together, retaining existing mutually exclusive choices. */
  async setAllLayerVisibility(visible: boolean, layerIds?: readonly string[], options: OptionalContentUpdateOptions = {}): Promise<void> {
    this.assertLive(); options.signal?.throwIfAborted();
    if (typeof visible !== "boolean") throw new TypeError("Layer visibility must be boolean.");
    const targets = this.editableTargets(layerIds);
    if (targets.size === 0) return;
    await this.update(this.planBulkVisibility(this.requested, visible, targets), options);
  }
  /** Summarize applied state, treating mutually exclusive alternatives as a complete choice. */
  getAllLayerVisibility(layerIds?: readonly string[]): LayerVisibilitySummary {
    this.assertLive();
    const targets = this.editableTargets(layerIds);
    const applied = new Map(this.current.layers.map(layer => [layer.id, layer.visible]));
    const enabled = [...targets].some(id => applied.get(id));
    if (!enabled) return { checked: false, indeterminate: false, disabled: targets.size === 0 };
    const complete = this.planBulkVisibility(applied, true, targets);
    const canEnableMore = [...targets].some(id => !applied.get(id) && complete.get(id));
    return { checked: !canEnableMore, indeterminate: canEnableMore, disabled: false };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.active?.abort(); this.active = null; this.listeners.clear();
    this.reportProgress(null);
  }
  private editableTargets(layerIds?: readonly string[]): Set<string> {
    if (layerIds !== undefined && !Array.isArray(layerIds)) throw new TypeError("Layer IDs must be an array.");
    const targets = new Set<string>();
    for (const id of layerIds ?? this.groups.keys()) {
      const group = this.groups.get(id);
      if (!group) throw new RangeError(`Unknown PDF layer: ${id}`);
      if (!group.locked && group.usedInView) targets.add(id);
    }
    return targets;
  }
  private planBulkVisibility(source: ReadonlyMap<string, boolean>, visible: boolean, targets: ReadonlySet<string>): Map<string, boolean> {
    const next = new Map(source);
    if (!visible) {
      for (const id of targets) next.set(id, false);
    } else {
      const memberships = new Map<string, number[]>();
      const occupied = new Set<number>();
      this.data?.radioGroups.forEach((radio, index) => {
        for (const id of radio) {
          let entries = memberships.get(id);
          if (!entries) memberships.set(id, entries = []);
          entries.push(index);
          if (next.get(id)) occupied.add(index);
        }
      });
      // Existing choices reserve every radio group they belong to,
      // including groups outside a filtered target list. Defaults break ties
      // only when no enabled member already owns that choice.
      for (const defaultVisible of [true, false]) for (const group of this.groups.values()) {
        if (group.defaultVisible !== defaultVisible || !targets.has(group.id) || next.get(group.id)) continue;
        const radios = memberships.get(group.id) ?? [];
        if (radios.some(index => occupied.has(index))) continue;
        next.set(group.id, true);
        for (const index of radios) occupied.add(index);
      }
    }
    return next;
  }
  private async update(next: Map<string, boolean>, options: OptionalContentUpdateOptions, force = false): Promise<void> {
    this.assertLive(); options.signal?.throwIfAborted();
    if (!force && !this.active && this.current.layers.every(layer => next.get(layer.id) === layer.visible)) return;
    this.active?.abort(new DOMException("Layer update superseded.", "AbortError"));
    const controller = new AbortController(), generation = ++this.generation;
    this.active = controller; this.requested = next;
    const abort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const value = this.data && this.data.conditions.length > 8192
        ? { revision: this.current.revision + 1, layers: this.data.groups.map(group => ({ id: group.id, visible: next.get(group.id) === true })),
          conditions: await evaluateCooperatively(this.data, next, controller.signal) }
        : snapshot(this.data, next, this.current.revision + 1);
      const preparation = this.options.prepare?.(cloneSnapshot(value), { signal: controller.signal,
        onProgress: percentage => { if (this.active === controller && !controller.signal.aborted) this.reportProgress(percentage); } });
      const commit = preparation ? await waitForLoad(preparation, controller.signal) : undefined;
      controller.signal.throwIfAborted();
      if (this.disposed || generation !== this.generation) throw new DOMException("Layer update superseded.", "AbortError");
      commit?.();
      this.current = value;
      this.active = null;
      for (const listener of this.listeners) {
        try { listener(cloneSnapshot(value)); } catch { /* Observers cannot roll back a committed update. */ }
      }
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (generation === this.generation) {
        this.active = null;
        this.requested = new Map(this.current.layers.map(layer => [layer.id, layer.visible]));
        this.reportProgress(null);
      }
    }
  }
  private reportProgress(value: number | null): void {
    try { this.options.onProgress?.(value); } catch { /* Progress observers cannot cancel state changes. */ }
  }
  private assertLive(): void { if (this.disposed) throw new Error("Optional-content controller has been disposed."); }
}
