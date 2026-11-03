import type { EditorLayerCreateOptions } from "./editorTypes";
import type { OptionalContentCondition, OptionalContentGroup, OptionalContentOrderNode, SceneOptionalContent } from "./optionalContentData";
import { validateSceneOptionalContent } from "./optionalContent";

export function editorLayerCatalog(source?: SceneOptionalContent): SceneOptionalContent {
  const data = source ? structuredClone(source) : { groups: [], conditions: [], order: [], radioGroups: [] };
  validateSceneOptionalContent(data);
  const present = new Set<string>(), stack = [...data.order];
  while (stack.length) { const node = stack.pop()!; if (node.kind === "group") present.add(node.groupId); if (node.children) stack.push(...node.children); }
  let order = data.order;
  for (const group of data.groups) if (group.annotationId !== undefined && present.has(group.id)) order = take(order, group.id, true).order;
  return { ...data, order: [...order, ...data.groups.filter(group => !group.annotationId && !present.has(group.id)).map(group => ({ kind: "group" as const, groupId: group.id }))] };
}

export function editorLayer(data: SceneOptionalContent, id: string): OptionalContentGroup {
  const group = data.groups.find(group => group.id === id);
  if (!group || group.annotationId !== undefined) throw new RangeError(`Unknown PDF layer: ${id}`);
  return group;
}

/** Import an expression by value, retaining the destination's stable condition addresses. */
export function importEditorLayerCondition(data: SceneOptionalContent, source: SceneOptionalContent, condition: number | undefined):
  { catalog: SceneOptionalContent; condition?: number } {
  if (condition === undefined) return { catalog: data };
  const conditions = [...data.conditions], intern = new Map(conditions.map((value, index) => [JSON.stringify(value), index]));
  const mapped = new Map<number, number>(), visiting = new Set<number>();
  const visit = (index: number): number => {
    const cached = mapped.get(index); if (cached !== undefined) return cached;
    const value = source.conditions[index];
    if (!Number.isSafeInteger(index) || !value || visiting.has(index)) throw new RangeError("Unknown or cyclic PDF layer condition.");
    visiting.add(index);
    if (value.kind === "group") editorLayer(data, value.groupId);
    const result = value.kind === "not" ? { ...value, operand: visit(value.operand) }
      : value.kind === "and" || value.kind === "or" ? { ...value, operands: value.operands.map(visit) } : { ...value };
    const key = JSON.stringify(result); let target = intern.get(key);
    if (target === undefined) { target = conditions.length; conditions.push(result); intern.set(key, target); }
    mapped.set(index, target); visiting.delete(index); return target;
  };
  const target = visit(condition), value = conditions[target];
  return { catalog: conditions.length === data.conditions.length ? data : { ...data, conditions },
    ...(value.kind === "constant" && value.value ? {} : { condition: target }) };
}

function name(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("A layer name is required.");
  return value.trim();
}

function boolean(value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") throw new TypeError("Layer visibility and lock values must be boolean.");
}

function take(nodes: readonly OptionalContentOrderNode[], id: string, promote: boolean): { order: OptionalContentOrderNode[]; found?: OptionalContentOrderNode } {
  let found: OptionalContentOrderNode | undefined;
  const visit = (values: readonly OptionalContentOrderNode[]): OptionalContentOrderNode[] => values.flatMap(node => {
    if (node.kind === "group" && node.groupId === id) { found ??= structuredClone(node); return promote ? visit(node.children ?? []) : []; }
    return [{ ...node, ...(node.children ? { children: visit(node.children) } : {}) }];
  });
  return { order: visit(nodes), get found() { return found; } };
}

function insert(data: SceneOptionalContent, node: OptionalContentOrderNode, parentId: string | null | undefined, index?: number): SceneOptionalContent {
  if (parentId != null) editorLayer(data, parentId);
  let inserted = false;
  const place = (nodes: readonly OptionalContentOrderNode[]): OptionalContentOrderNode[] => {
    const at = index ?? nodes.length;
    if (!Number.isSafeInteger(at) || at < 0 || at > nodes.length) throw new RangeError("Layer position is outside its parent's children.");
    inserted = true; const next = [...nodes]; next.splice(at, 0, node); return next;
  };
  const visit = (nodes: readonly OptionalContentOrderNode[]): OptionalContentOrderNode[] => nodes.map(value =>
    value.kind === "group" && value.groupId === parentId ? { ...value, children: place(value.children ?? []) }
      : { ...value, ...(value.children ? { children: visit(value.children) } : {}) });
  const order = parentId == null ? place(data.order) : visit(data.order);
  if (!inserted) throw new RangeError("The parent layer is absent from the layer order.");
  return { ...data, order };
}

export function createEditorLayer(data: SceneOptionalContent, id: string, options: EditorLayerCreateOptions): SceneOptionalContent {
  if (data.groups.some(group => group.id === id)) throw new RangeError("Layer ID already exists.");
  const visible = options.defaultVisible ?? true, locked = options.locked ?? false; boolean(visible); boolean(locked);
  const group = { id, name: name(options.name), defaultVisible: visible, locked, usedInView: true };
  return insert({ ...data, groups: [...data.groups, group], conditions: [...data.conditions, { kind: "group", groupId: id }] },
    { kind: "group", groupId: id }, options.parentId, options.index);
}

export function updateEditorLayer(data: SceneOptionalContent, id: string,
  patch: { name?: string; defaultVisible?: boolean; locked?: boolean }): SceneOptionalContent {
  const group = editorLayer(data, id), next = { ...group, ...(patch.name === undefined ? {} : { name: name(patch.name) }) };
  if (patch.locked !== undefined) { boolean(patch.locked); next.locked = patch.locked; }
  if (patch.defaultVisible !== undefined) {
    boolean(patch.defaultVisible);
    if (patch.defaultVisible !== group.defaultVisible && !group.usedInView) throw new Error(`PDF layer is not enabled for the View intent: ${group.name}`);
    if (patch.defaultVisible !== group.defaultVisible && group.locked && patch.locked !== false) throw new Error(`Unlock visibility before changing PDF layer: ${group.name}`);
    next.defaultVisible = patch.defaultVisible;
  }
  const turnOff = new Set<string>();
  if (patch.defaultVisible === true) for (const radio of data.radioGroups) if (radio.includes(id)) for (const other of radio) if (other !== id) {
    const sibling = editorLayer(data, other);
    if (sibling.defaultVisible && (sibling.locked || !sibling.usedInView)) throw new Error(`PDF layer cannot be changed: ${sibling.name}`);
    turnOff.add(other);
  }
  const groups = data.groups.map(value => value.id === id ? next : turnOff.has(value.id) ? { ...value, defaultVisible: false } : value);
  if (groups.every((value, index) => JSON.stringify(value) === JSON.stringify(data.groups[index]))) return data;
  return { ...data, groups };
}

export function moveEditorLayer(data: SceneOptionalContent, id: string, position: { parentId?: string | null; index: number }): SceneOptionalContent {
  editorLayer(data, id); const removed = take(data.order, id, false), node = removed.found ?? { kind: "group" as const, groupId: id };
  const descendants = [node];
  while (descendants.length) { const child = descendants.pop()!; if (child.kind === "group" && child.groupId === position.parentId) throw new Error("A layer cannot be moved inside itself or its descendants."); if (child.children) descendants.push(...child.children); }
  const result = insert({ ...data, order: removed.order }, node, position.parentId, position.index);
  return JSON.stringify(result.order) === JSON.stringify(data.order) ? data : result;
}

export function setEditorLayerOrder(data: SceneOptionalContent, input: readonly OptionalContentOrderNode[]): SceneOptionalContent {
  const order = structuredClone(input), seen = new Set<string>(), stack = [...order];
  const result = { ...data, order }; validateSceneOptionalContent(result);
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "group") { editorLayer(data, node.groupId); if (seen.has(node.groupId)) throw new Error("Each layer must appear once in the layer order."); seen.add(node.groupId); }
    if (node.children) stack.push(...node.children);
  }
  if (data.groups.some(group => !group.annotationId && !seen.has(group.id))) throw new Error("The layer order must include every PDF layer.");
  return JSON.stringify(order) === JSON.stringify(data.order) ? data : result;
}

/** Existentially forget a visibility variable, including negated memberships. */
function forget(conditions: readonly OptionalContentCondition[], id: string): OptionalContentCondition[] {
  const output = conditions.map(value => structuredClone(value)), intern = new Map(output.map((node, index) => [JSON.stringify(node), index]));
  const put = (node: OptionalContentCondition): number => { const key = JSON.stringify(node), old = intern.get(key); if (old !== undefined) return old; const index = output.length; output.push(node); intern.set(key, index); return index; };
  const join = (kind: "and" | "or", operands: number[]): number => {
    const kept: number[] = [];
    for (const index of new Set(operands)) {
      const node = output[index];
      if (node.kind === "constant") { if (node.value === (kind === "or")) return index; }
      else kept.push(index);
    }
    return kept.length === 1 ? kept[0] : kept.length ? put({ kind, operands: kept }) : put({ kind: "constant", value: kind === "and" });
  };
  const restricted = (value: boolean): number[] => {
    const mapped: number[] = [], stack: number[] = [];
    for (let root = 0; root < conditions.length; root++) {
      stack.push(root);
      while (stack.length) {
        const index = stack[stack.length - 1], node = conditions[index];
        if (mapped[index] !== undefined) { stack.pop(); continue; }
        const children = node.kind === "not" ? [node.operand] : node.kind === "and" || node.kind === "or" ? node.operands : [];
        const missing = children.find(child => mapped[child] === undefined);
        if (missing !== undefined) { stack.push(missing); continue; }
        mapped[index] = node.kind === "group" ? node.groupId === id ? put({ kind: "constant", value }) : index
          : node.kind === "constant" ? index : node.kind === "not" ? output[mapped[node.operand]].kind === "constant"
            ? put({ kind: "constant", value: !(output[mapped[node.operand]] as { value: boolean }).value }) : put({ kind: "not", operand: mapped[node.operand] })
            : join(node.kind, node.operands.map(child => mapped[child]));
        stack.pop();
      }
    }
    return mapped;
  };
  const on = restricted(true), off = restricted(false), replacements = conditions.map((_, index) => structuredClone(output[join("or", [on[index], off[index]])]));
  for (let index = 0; index < replacements.length; index++) output[index] = replacements[index];
  return output;
}

export function removeEditorLayer(data: SceneOptionalContent, id: string, targetLayerId: string | null): SceneOptionalContent {
  editorLayer(data, id);
  if (targetLayerId === id) throw new Error("Choose a different destination layer.");
  if (targetLayerId !== null) editorLayer(data, targetLayerId);
  const result: SceneOptionalContent = { ...data, groups: data.groups.filter(group => group.id !== id),
    conditions: targetLayerId === null ? forget(data.conditions, id) : data.conditions.map(node => node.kind === "group" && node.groupId === id ? { ...node, groupId: targetLayerId } : node),
    order: take(data.order, id, true).order,
    radioGroups: data.radioGroups.map(radio => radio.filter(group => group !== id)).filter(radio => radio.length > 1) };
  validateSceneOptionalContent(result); return result;
}
