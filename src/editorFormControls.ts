import type { SceneAnnotation } from "./annotationData";
import type { EditorFieldValue } from "./editorTypes";

export type EditorFieldControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
let nextChoiceList = 0;

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
  value: EditorFieldValue | undefined, onChange: (value: EditorFieldValue) => void): EditorFieldControl | null {
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
  input.addEventListener("change", () => onChange(getValue()));
  return input;
}
