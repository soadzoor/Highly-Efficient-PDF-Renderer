import {
  MAX_OPTIONAL_CONTENT_CONDITIONS,
  MAX_OPTIONAL_CONTENT_GROUPS,
  type OptionalContentCondition,
  type OptionalContentGroup,
  type SceneOptionalContent
} from "./optionalContentData";

/** Preferred layer id; builders avoid collisions with actual PDF layer ids. */
export function annotationLayerId(annotationId: string): string {
  return `annotation:${annotationId}`;
}

/** HEPR annotation layers are not PDF layers; layer APIs and panels omit them. */
export function isAnnotationLayer(group: OptionalContentGroup): boolean {
  return group.annotationId !== undefined;
}

/**
 * Gives each annotation appearance on one page its own visibility condition,
 * combined with any PDF layer it already belongs to. Conditions are appended
 * to the page's own table, so its existing indexes stay valid, and nothing is
 * added to the document-wide layer registry.
 */
export class AnnotationLayerBuilder {
  private readonly base: SceneOptionalContent | undefined;
  private readonly conditions: OptionalContentCondition[];
  private readonly groups: OptionalContentGroup[] = [];
  private readonly groupConditions = new Map<string, number>();
  private readonly combined = new Map<string, number>();
  private readonly unavailable = new Set<string>();
  private readonly usedIds = new Set<string>();
  private readonly existingGroups = new Map<string, OptionalContentGroup>();
  private initialized = false;

  /** `conditions` starts as the page's table and receives the appended entries. */
  constructor(base: SceneOptionalContent | undefined, conditions: OptionalContentCondition[]) {
    this.base = base;
    this.conditions = conditions;
  }

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (const group of this.base?.groups ?? []) {
      this.usedIds.add(group.id);
      if (group.annotationId !== undefined && !this.existingGroups.has(group.annotationId)) this.existingGroups.set(group.annotationId, group);
    }
    if (!this.existingGroups.size) return;
    const byId = new Map([...this.existingGroups.values()].map(group => [group.id, group]));
    for (let index = 0; index < this.conditions.length; index++) {
      const condition = this.conditions[index]; if (condition.kind !== "group") continue;
      const group = byId.get(condition.groupId);
      if (group?.annotationId !== undefined && this.existingGroups.get(group.annotationId) === group && !this.groupConditions.has(group.annotationId)) {
        this.groupConditions.set(group.annotationId, index);
      }
    }
    // Rewrapping an existing appearance should reuse its common AND gate too.
    const gates = new Set(this.groupConditions.values());
    for (let index = 0; index < this.conditions.length; index++) {
      const condition = this.conditions[index]; if (condition.kind !== "and" || condition.operands.length !== 2) continue;
      const [first, second] = condition.operands;
      if (gates.has(first)) this.combined.set(`${second}:${first}`, index);
      if (gates.has(second)) this.combined.set(`${first}:${second}`, index);
    }
  }

  /** Annotations beyond the layer ceilings keep painting without their own layer. */
  get unavailableCount(): number {
    return this.unavailable.size;
  }

  /** The condition for paint owned by `annotationId`, or `condition` itself when it has no layer. */
  condition(condition: number | undefined, annotationId: string | undefined): number | undefined {
    if (annotationId === undefined) return condition;
    this.initialize();
    let group = this.groupConditions.get(annotationId);
    if (group === undefined) {
      const existing = this.existingGroups.get(annotationId);
      if (this.unavailable.has(annotationId) ||
          (!existing && (this.base?.groups.length ?? 0) + this.groups.length >= MAX_OPTIONAL_CONTENT_GROUPS) ||
          this.conditions.length + 2 > MAX_OPTIONAL_CONTENT_CONDITIONS) {
        this.unavailable.add(annotationId);
        return condition;
      }
      let id = existing?.id ?? annotationLayerId(annotationId);
      if (!existing) {
        let collision = 0;
        while (this.usedIds.has(id)) id = `hepr-annotation:${JSON.stringify([annotationId, collision++])}`;
        this.usedIds.add(id);
        this.groups.push({ id, name: `Annotation ${annotationId}`, defaultVisible: true, locked: true, usedInView: false, annotationId });
      }
      group = this.conditions.length;
      this.conditions.push({ kind: "group", groupId: id });
      this.groupConditions.set(annotationId, group);
    }
    if (condition === undefined || condition === group) return group;
    const key = `${condition}:${group}`;
    let index = this.combined.get(key);
    if (index === undefined) {
      if (this.conditions.length + 1 > MAX_OPTIONAL_CONTENT_CONDITIONS) {
        this.unavailable.add(annotationId);
        return condition;
      }
      index = this.conditions.length;
      this.conditions.push({ kind: "and", operands: [condition, group] });
      this.combined.set(key, index);
    }
    return index;
  }

  /**
   * The page's layer tables including its annotation layers. Without any, a
   * page with PDF layers keeps its (possibly extended) table and a page
   * without them stays without optional content.
   */
  build(): SceneOptionalContent | undefined {
    if (!this.groups.length && !this.base) return undefined;
    // Annotation layers stay out of the display order and radio groups.
    return {
      groups: [...(this.base?.groups ?? []), ...this.groups],
      conditions: this.conditions,
      order: this.base?.order ?? [],
      radioGroups: this.base?.radioGroups ?? []
    };
  }
}
