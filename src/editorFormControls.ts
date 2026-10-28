import type { SceneAnnotation } from "./annotationData";
import type { EditorFieldValue } from "./editorTypes";
import { choosePdfFormAutoFontSize } from "./pdf/formAutoFontSize";

export type EditorFieldControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
let nextChoiceList = 0;
const measureContexts = new WeakMap<Document, CanvasRenderingContext2D | null>();

/** Sizes are PDF-local units: the existing field matrix supplies zoom and UserUnit. */
export function styleEditorFieldControl(control: EditorFieldControl, annotation: SceneAnnotation, fontFamily?: string): void {
  if (control.tagName === "INPUT" && /^(checkbox|radio)$/.test((control as HTMLInputElement).type)) return;
  const field = annotation.field, style = field?.textStyle;
  const family = fontFamily ?? JSON.stringify(style?.fontFamily ?? "Liberation Sans");
  const weight = style?.fontWeight ?? 400, italic = style?.fontStyle ?? "normal";
  const rect = annotation.pdfGeometry?.rect, bounds = annotation.bounds;
  const width = rect ? Math.abs(rect[2] - rect[0]) : bounds ? bounds.maxX - bounds.minX : 100;
  const height = rect ? Math.abs(rect[3] - rect[1]) : bounds ? bounds.maxY - bounds.minY : 20;
  const padding = style?.contentInset ?? Math.max(1, (annotation.border?.width ?? 0) + 1);
  const innerWidth = Math.max(0, width - padding * 2), innerHeight = Math.max(0, height - padding * 2);
  const multiline = control.tagName === "TEXTAREA" || control.tagName === "SELECT" && (control as HTMLSelectElement).size > 1;
  const document = control.ownerDocument;
  let context: CanvasRenderingContext2D | null = null;
  if (document) {
    if (!measureContexts.has(document)) measureContexts.set(document, document.createElement("canvas").getContext?.("2d") ?? null);
    context = measureContexts.get(document) ?? null;
  }
  const value = control.tagName === "SELECT"
    ? Array.from((control as HTMLSelectElement).selectedOptions, item => item.textContent ?? item.value).join(multiline ? "\n" : "") : control.value;
  const text = (control as HTMLInputElement).type === "password" ? "\u2022".repeat(Array.from(value).length) : value;
  const fits = (size: number): boolean => {
    if (context) context.font = `${italic} ${weight} ${size}px ${family}`;
    const measure = (part: string): number => context?.measureText(part).width ?? Array.from(part).length * size * .5;
    const emHeight = Math.max(.01, (style?.ascent ?? .8) - (style?.descent ?? -.2));
    const tooTall = (lines: number): boolean => size * (emHeight + Math.max(0, lines - 1) * 1.2) > innerHeight + 1e-7;
    let lines = 0;
    for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
      if (!multiline) { if (measure(paragraph) > innerWidth) return false; lines++; continue; }
      let line = ""; lines++; if (tooTall(lines)) return false;
      for (const word of paragraph.split(/(?<=\s)/u)) {
        if (line && measure(line + word.trimEnd()) > innerWidth) { lines++; if (tooTall(lines)) return false; line = ""; }
        for (const character of word) {
          if (line && measure(line + character) > innerWidth) { lines++; if (tooTall(lines)) return false; line = ""; }
          line += character;
        }
      }
    }
    return !tooTall(lines);
  };
  const size = style?.fontSize === 0 ? choosePdfFormAutoFontSize(multiline, fits) : style?.fontSize ?? 12;
  Object.assign(control.style, { fontFamily: family, fontSize: `${size}px`, fontWeight: String(weight), fontStyle: italic,
    fontSynthesis: "none", lineHeight: "1.2", textAlign: field?.alignment === 1 ? "center" : field?.alignment === 2 ? "right" : "left",
    padding: `${padding}px`, color: style ? `rgb(${style.color.map(component => Math.round(component * 255)).join(",")})` : "#111" });
}

/** Options remain separate siblings so the positioned field control API stays unchanged. */
export function createEditorFieldOptions(document: Document, annotation: SceneAnnotation, control: EditorFieldControl): HTMLDataListElement | null {
  const field = annotation.field;
  if (field?.type !== "Ch" || !(field.flags & 262144) || control.tagName !== "INPUT" || !field.options?.length) return null;
  const list = document.createElement("datalist"); list.id = `hepr-editable-choice-${++nextChoiceList}`;
  control.setAttribute("list", list.id);
  for (const choice of field.options) {
    const option = document.createElement("option"); option.value = choice.value; option.label = choice.label; option.textContent = choice.label; list.append(option);
  }
  return list;
}

/** Update shared widgets without replacing focused controls or their caret. */
export function setEditorFieldControlValue(control: EditorFieldControl, annotation: SceneAnnotation, value: EditorFieldValue): void {
  if (control.tagName === "SELECT") {
    const select = control as HTMLSelectElement;
    if (select.multiple) {
      const values = Array.isArray(value) ? value : [String(value ?? "")];
      for (const option of select.options) option.selected = values.includes(option.value);
    } else {
      const text = Array.isArray(value) ? value[0] ?? "" : String(value ?? ""); if (select.value !== text) select.value = text;
    }
  } else if (control.tagName === "INPUT" && /^(checkbox|radio)$/.test((control as HTMLInputElement).type)) {
    const button = control as HTMLInputElement; button.checked = value === true || value === (annotation.field?.onValue ?? "Yes");
  } else {
    const text = String(value ?? ""); if (control.value !== text) control.value = text;
  }
  styleEditorFieldControl(control, annotation, control.style.fontFamily);
}

export function editorFieldDraftSignature(control: EditorFieldControl): string {
  if (control.tagName === "SELECT" && (control as HTMLSelectElement).multiple) {
    return JSON.stringify(Array.from((control as HTMLSelectElement).selectedOptions, option => option.value));
  }
  if (control.tagName === "INPUT" && /^(checkbox|radio)$/.test((control as HTMLInputElement).type)) {
    const input = control as HTMLInputElement; return JSON.stringify([input.checked, input.value]);
  }
  return control.value;
}

export function hasPendingEditorFields(drafts: ReadonlyMap<EditorFieldControl, string>): boolean {
  for (const [control, baseline] of drafts) if (editorFieldDraftSignature(control) !== baseline) return true;
  return false;
}

/** Snapshot changed controls before change handlers replace their DOM siblings. */
export function flushEditorFieldDrafts(drafts: ReadonlyMap<EditorFieldControl, string>): void {
  const controls = [...drafts.keys()];
  const changed = [...drafts].filter(([control, baseline]) => editorFieldDraftSignature(control) !== baseline).map(([control]) => control);
  for (const control of changed) {
    const input = control as HTMLInputElement;
    if (input.type === "radio" && !input.checked && controls.some(other => {
      const radio = other as HTMLInputElement; return radio.type === "radio" && radio.name === input.name && radio.checked;
    })) continue;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/** Accessible native controls; PDF scripts and actions remain inert. */
export function createEditorFieldControl(document: Document, annotation: SceneAnnotation,
  value: EditorFieldValue | undefined, onChange: (value: EditorFieldValue) => void,
  options: { usePdfAppearance?: boolean } = {}): EditorFieldControl | null {
  const field = annotation.field;
  if (annotation.subtype !== "Widget" || !field?.name || field.flags & 1 || !annotation.visibleInDefaultView) return null;
  let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const current = value ?? field.value;
  let getValue: () => EditorFieldValue;
  if (field.type === "Tx") {
    const text = document.createElement(field.flags & 4096 ? "textarea" : "input");
    if (field.maxLength) text.maxLength = field.maxLength;
    if (text.tagName === "INPUT" && field.flags & 8192) (text as HTMLInputElement).type = "password";
    text.value = String(current ?? ""); input = text; getValue = () => text.value;
  } else if (field.type === "Ch") {
    if (field.flags & 262144) {
      const text = document.createElement("input"); text.value = String(current ?? ""); input = text; getValue = () => text.value;
    } else {
      const select = document.createElement("select"); select.multiple = Boolean(field.flags & 2097152);
      select.size = field.flags & 131072 ? 1 : Math.max(2, field.options?.length ?? 0);
      for (const option of field.options ?? []) {
        const item = document.createElement("option"); item.value = option.value; item.textContent = option.label;
        item.selected = Array.isArray(current) ? current.includes(option.value) : String(current ?? "") === option.value; select.append(item);
      }
      input = select; getValue = () => select.multiple ? Array.from(select.selectedOptions, item => item.value) : select.value;
    }
  } else if (field.type === "Btn" && !(field.flags & 65536)) {
    const button = document.createElement("input"); button.type = field.flags & 32768 ? "radio" : "checkbox";
    button.name = `hepr-field-${field.name}`; button.value = field.onValue ?? "Yes";
    button.checked = current === true || current === button.value; input = button;
    getValue = () => button.checked ? button.value : "Off";
  } else return null;
  input.dataset.fieldId = annotation.id; input.setAttribute("aria-label", annotation.tooltip || field.name);
  input.className = "hepr-editor-field";
  if (options.usePdfAppearance) input.dataset.pdfAppearance = "true";
  styleEditorFieldControl(input, annotation);
  input.addEventListener("input", () => styleEditorFieldControl(input, annotation, input.style.fontFamily));
  input.addEventListener("change", () => onChange(getValue()));
  return input;
}
