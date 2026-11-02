import type { EditorSourceEdit } from "./editorTypes";
import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { normalizePrimitiveColor } from "./colorInput";
import { getSceneAnnotationRuns, type PrimitiveRef } from "./scenePrimitives";
import { applyEditorSourceColors, editorSourcePaintColors } from "./editorSourceColors";
import { retainEditorPaintIdentity } from "./editorPaintIdentity";

type Rgb = [number, number, number];
const key = (ref: PrimitiveRef): string => `${ref.kind}:${ref.index}`;
const role = (ref: PrimitiveRef): string => ref.kind === "gradient-fill" ? "fill" : ref.kind === "gradient-stroke" ? "stroke" : ref.kind;
const same = (left: readonly number[], right: readonly number[]): boolean => left.every((value, index) => Math.abs(value - right[index]) <= 1e-7);

/** Regenerated widgets have new glyph/path indices. Transfer complete uniform
 * paint-role edits by annotation ownership instead of reusing old indices. */
export function applyEditorSourceFieldColors(source: VectorScene, compiled: VectorScene, edits: readonly EditorSourceEdit[]): VectorScene {
  const overrides = new Map(edits.filter(edit => edit.color !== undefined && !edit.deleted).map(edit => [key(edit.ref), normalizePrimitiveColor(edit.color!)]));
  if (!overrides.size) return compiled;
  const fields = source.annotations?.filter(annotation => annotation.field) ?? []; if (!fields.length) return compiled;
  const originalRuns = getSceneAnnotationRuns(source), changes: EditorSourceEdit[] = [], fieldColors = new Map<string, Rgb>();
  let currentRuns: ReturnType<typeof getSceneAnnotationRuns> | undefined;
  const refs = (scene: VectorScene, runs: readonly VectorDrawRun[]): PrimitiveRef[] =>
    runs.flatMap(run => Array.from({ length: run.count }, (_, index) => ({ kind: run.kind, index: run.first + index })))
      .filter(ref => editorSourcePaintColors(scene, [ref]).color.length > 0);
  for (const annotation of fields) {
    if (!annotation.field) continue;
    const before = refs(source, originalRuns.get(annotation.id) ?? []);
    if (!before.length || !before.some(ref => overrides.has(key(ref)))) continue;
    const uniform = (members: readonly PrimitiveRef[]): Rgb | undefined => {
      const first = members.length ? overrides.get(key(members[0])) : undefined;
      return first && members.every(ref => { const value = overrides.get(key(ref)); return value !== undefined && same(first, value); }) ? first : undefined;
    };
    const all = uniform(before), roles = new Map<string, PrimitiveRef[]>();
    for (const ref of before) { const name = role(ref), members = roles.get(name) ?? []; members.push(ref); roles.set(name, members); }
    const colors = new Map([...roles].flatMap(([name, members]) => { const color = uniform(members); return color ? [[name, color] as const] : []; }));
    const text = all ?? colors.get("text");
    if (text && (annotation.field.type === "Tx" || annotation.field.type === "Ch")) fieldColors.set(annotation.id, text);
    if (!all && !colors.size) continue;
    currentRuns ??= getSceneAnnotationRuns(compiled);
    for (const ref of refs(compiled, currentRuns.get(annotation.id) ?? [])) {
      const color = all ?? colors.get(role(ref)); if (!color) continue;
      const current = editorSourcePaintColors(compiled, [ref]).color;
      if (current.every(value => same(normalizePrimitiveColor(value), color))) continue;
      changes.push({ ref, color, transform: [1, 0, 0, 1, 0, 0], deleted: false });
    }
  }
  const result = applyEditorSourceColors(compiled, changes); let changed = false;
  const annotations = result.annotations?.map(annotation => {
    const color = fieldColors.get(annotation.id), field = annotation.field, style = field?.textStyle;
    if (!color || !field || !style || same(style.color, color)) return annotation;
    changed = true; return { ...annotation, field: { ...field, textStyle: { ...style, color: [...color] } } };
  });
  if (!changed) return result;
  const styled = { ...result, annotations }; retainEditorPaintIdentity(result, styled); return styled;
}
