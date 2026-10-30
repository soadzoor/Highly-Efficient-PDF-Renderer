import type { SceneOptionalContent, OptionalContentOrderNode } from "./optionalContentData";
import { PdfByteWriter, pdfRef, pdfUtf16Hex } from "./editorPdfBytes";

interface Expression { value: string | boolean; visible: boolean; groups: readonly number[]; reference?: number }

/** PDF optional-content resources, shared across pages and appearance Forms. */
export class EditorPdfLayers {
  private readonly groups = new Map<string, number>();
  private readonly expressions = new WeakMap<SceneOptionalContent, Map<number, Expression>>();
  private readonly writer: PdfByteWriter;
  private readonly data: SceneOptionalContent | undefined;
  private readonly flatten: boolean;
  constructor(writer: PdfByteWriter, data: SceneOptionalContent | undefined, flatten = false) {
    this.writer = writer; this.data = data; this.flatten = flatten;
    if (!flatten) for (const group of data?.groups ?? []) if (!group.annotationId) this.groups.set(group.id,
      writer.add(`<< /Type /OCG /Name ${pdfUtf16Hex(group.name)} /HEPRLayerId ${pdfUtf16Hex(group.id)} >>`));
  }

  catalog(): string {
    const data = this.data;
    if (this.flatten || !data || !this.groups.size) return "";
    const references = (ids: readonly string[]) => ids.filter(id => this.groups.has(id)).map(id => pdfRef(this.groups.get(id)!)).join(" ");
    const order = (nodes: readonly OptionalContentOrderNode[]): string => nodes.map(node => {
      const children = node.children?.length ? order(node.children) : "";
      if (node.kind === "label") return children ? `[${pdfUtf16Hex(node.label)} ${children}]` : "";
      if (!this.groups.has(node.groupId)) return children;
      const reference = pdfRef(this.groups.get(node.groupId)!);
      return `${reference}${children ? ` [${children}]` : ""}`;
    }).join(" ");
    return `/OCProperties << /OCGs [${references(data.groups.map(group => group.id))}] /D << /BaseState /ON ` +
      `/OFF [${references(data.groups.filter(group => !group.defaultVisible).map(group => group.id))}] ` +
      `/Order [${order(data.order)}] /Locked [${references(data.groups.filter(group => group.locked).map(group => group.id))}] ` +
      `/RBGroups [${data.radioGroups.map(ids => references(ids)).filter(Boolean).map(value => `[${value}]`).join(" ")}] >> >>`;
  }

  wrap(content: string, data: SceneOptionalContent | undefined, condition: number | undefined,
    useProperty: (reference: number) => string): string {
    if (!content || condition === undefined) return content;
    if (!data) throw new RangeError("A PDF layer condition has no layer table.");
    const expression = this.expression(data, condition);
    if (this.flatten) return expression.visible ? content : "";
    if (typeof expression.value === "boolean") return expression.value ? content : "";
    expression.reference ??= this.writer.add(`<< /Type /OCMD /OCGs [${expression.groups.map(pdfRef).join(" ")}] /VE ${expression.value} >>`);
    return `/OC ${useProperty(expression.reference)} BDC\n${content}EMC\n`;
  }

  /** Annotation memberships share the page writer's OCG/OCMD resources. */
  annotationCondition(data: SceneOptionalContent | undefined, condition: number): number | boolean {
    if (!data) throw new RangeError("A PDF annotation layer condition has no layer table.");
    const expression = this.expression(data, condition);
    if (this.flatten || typeof expression.value === "boolean") return expression.visible;
    expression.reference ??= this.writer.add(`<< /Type /OCMD /OCGs [${expression.groups.map(pdfRef).join(" ")}] /VE ${expression.value} >>`);
    return expression.reference;
  }

  private expression(data: SceneOptionalContent, index: number): Expression {
    let cache = this.expressions.get(data); if (!cache) { cache = new Map(); this.expressions.set(data, cache); }
    const cached = cache.get(index); if (cached) return cached;
    const condition = data.conditions[index];
    if (!condition) throw new RangeError("Unknown PDF layer condition.");
    let result: Expression;
    if (condition.kind === "constant") result = { value: condition.value, visible: condition.value, groups: [] };
    else if (condition.kind === "group") {
      const group = data.groups.find(group => group.id === condition.groupId);
      if (!group) throw new RangeError("Unknown PDF layer.");
      const reference = this.groups.get(group.id);
      result = { value: group.annotationId ? true : this.flatten ? group.defaultVisible : pdfRef(reference!), visible: group.annotationId ? true : group.defaultVisible,
        groups: reference === undefined ? [] : [reference] };
    } else if (condition.kind === "not") {
      const child = this.expression(data, condition.operand);
      result = { value: typeof child.value === "boolean" ? !child.value : `[/Not ${child.value}]`, visible: !child.visible, groups: child.groups };
    } else {
      const children = condition.operands.map(index => this.expression(data, index)), and = condition.kind === "and";
      const decisive = children.find(child => child.value === !and), remaining = children.filter(child => typeof child.value !== "boolean");
      const value = decisive ? !and : !remaining.length ? and : remaining.length === 1 ? remaining[0].value
        : `[/${and ? "And" : "Or"} ${remaining.map(child => child.value).join(" ")}]`;
      result = { value, visible: and ? children.every(child => child.visible) : children.some(child => child.visible),
        groups: [...new Set(children.flatMap(child => child.groups))] };
    }
    // /VE requires an expression array even when its sole operand is an OCG.
    if (typeof result.value === "string" && !result.value.startsWith("[")) result.value = `[/And ${result.value}]`;
    cache.set(index, result); return result;
  }
}
