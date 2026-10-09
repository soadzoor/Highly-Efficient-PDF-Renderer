import { MAX_OPTIONAL_CONTENT_GROUPS, type OptionalContentCondition, type OptionalContentGroup, type OptionalContentOrderNode,
  type SceneOptionalContent } from "./optionalContentData";

/** Compose pages of one document while keeping catalog identities and remapping local conditions. */
export function composeOptionalContent(pages: readonly (SceneOptionalContent | undefined)[]): {
  data: SceneOptionalContent | undefined;
  offsets: number[];
  /** Annotation layers left out to keep the scene within its layer ceiling. */
  droppedAnnotationLayers: number;
} {
  const groups = new Map<string, OptionalContentGroup>();
  // PDF layers always fit; page-local annotation layers use what remains.
  const pdfLayers = new Set<string>();
  for (const page of pages) for (const group of page?.groups ?? []) if (group.annotationId === undefined) pdfLayers.add(group.id);
  let annotationLayerBudget = MAX_OPTIONAL_CONTENT_GROUPS - pdfLayers.size, droppedAnnotationLayers = 0;
  const conditions: OptionalContentCondition[] = [];
  const offsets: number[] = [];
  const order: OptionalContentOrderNode[] = [];
  const orderGroups = new Set<string>();
  const radioGroups = new Map<string, readonly string[]>();
  const collect = (nodes: readonly OptionalContentOrderNode[]): void => {
    const pending = [...nodes];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.kind === "group") orderGroups.add(node.groupId);
      if (node.children) for (const child of node.children) pending.push(child);
    }
  };
  for (const page of pages) {
    const offset = conditions.length;
    offsets.push(offset);
    if (!page) continue;
    const dropped = new Set<string>();
    for (const group of page.groups) {
      if (groups.has(group.id)) continue;
      if (group.annotationId !== undefined && annotationLayerBudget <= 0) {
        dropped.add(group.id); droppedAnnotationLayers++;
        continue;
      }
      if (group.annotationId !== undefined) annotationLayerBudget--;
      groups.set(group.id, group);
    }
    for (const condition of page.conditions) {
      // A dropped annotation layer keeps its appearance permanently visible.
      conditions.push(condition.kind === "and" || condition.kind === "or"
        ? { kind: condition.kind, operands: condition.operands.map(index => index + offset) }
        : condition.kind === "not" ? { kind: "not", operand: condition.operand + offset }
          : condition.kind === "group" && dropped.has(condition.groupId) ? { kind: "constant", value: true } : { ...condition });
    }
    if (!order.length) { for (const node of page.order) order.push(node); collect(page.order); }
    for (const radio of page.radioGroups) radioGroups.set(JSON.stringify(radio), [...radio]);
  }
  // Annotation layers are not PDF layers and never join the display order.
  for (const group of groups.values()) if (!orderGroups.has(group.id) && group.annotationId === undefined) order.push({ kind: "group", groupId: group.id });
  return { data: groups.size ? { groups: [...groups.values()], conditions, order, radioGroups: [...radioGroups.values()] } : undefined, offsets,
    droppedAnnotationLayers };
}
