import type { EditorColor, EditorFieldObject, EditorFieldType } from "./editorTypes";
import { normalizePrimitiveColor } from "./colorInput";

export type EditorFieldSettings = Omit<EditorFieldObject, "id" | "pageIndex" | "transform" | "x" | "y" | "width" | "height">;
export interface EditorFieldDialog { close(): void; apply(): boolean; hasDraftChanges(): boolean }

/** The first separator splits an export value from its visible label. */
export function parseEditorFieldOptions(value: string): { value: string; label: string }[] {
  const seen = new Set<string>();
  return value.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const split = line.indexOf("|"), value = (split < 0 ? line : line.slice(0, split)).trim(), label = (split < 0 ? line : line.slice(split + 1)).trim();
    if (!value || seen.has(value)) throw new Error("Give every option a different, nonempty export value.");
    seen.add(value); return { value, label: label || value };
  });
}
const colorHex = (value: EditorColor): string => `#${normalizePrimitiveColor(value).map(component => Math.round(component * 255).toString(16).padStart(2, "0")).join("")}`;
const textValue = (value: EditorFieldObject["value"]): string => Array.isArray(value) ? value.join("\n") : String(value ?? "");

/** Shared creation/properties dialog. The caller owns placement and the undo transaction. */
export function showEditorFieldDialog(document: Document, initial: Partial<EditorFieldObject>,
  onApply: (settings: EditorFieldSettings) => void, onClose: () => void): EditorFieldDialog {
  const dialog = document.createElement("dialog"); dialog.className = "hepr-editor-field-dialog";
  dialog.setAttribute("aria-label", initial.id ? "Form field properties" : "Add a form field");
  const title = document.createElement("h2"); title.textContent = initial.id ? "Form field properties" : "Add a form field";
  const grid = document.createElement("div"); grid.className = "hepr-editor-field-settings";
  const row = (caption: string, control: HTMLElement): HTMLLabelElement => {
    const label = document.createElement("label"); label.append(document.createTextNode(caption), control); grid.append(label); return label;
  };
  const input = (caption: string, type: string, value: string): HTMLInputElement => {
    const control = document.createElement("input"); control.type = type; control.value = value; control.setAttribute("aria-label", caption); row(caption, control); return control;
  };
  const checkbox = (caption: string, checked: boolean): HTMLInputElement => {
    const control = input(caption, "checkbox", ""); control.checked = checked; control.parentElement!.className = "hepr-editor-field-checkbox"; return control;
  };
  const textarea = (caption: string, value: string): HTMLTextAreaElement => {
    const control = document.createElement("textarea"); control.rows = 3; control.value = value; control.setAttribute("aria-label", caption); row(caption, control); return control;
  };
  const type = document.createElement("select"); type.setAttribute("aria-label", "Field type");
  for (const [value, label] of [["text", "Text"], ["number", "Number"], ["date", "Date"], ["email", "Email"], ["tel", "Telephone"], ["url", "URL"],
    ["checkbox", "Checkbox"], ["radio", "Radio button"], ["dropdown", "Dropdown"], ["list", "List"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = label; type.append(option);
  }
  type.value = initial.fieldType ?? "text"; row("Field type", type);
  const name = input("Field name", "text", initial.name ?? "Field"); name.required = true;
  const tooltip = input("Tooltip / accessible label", "text", initial.tooltip ?? "");
  const current = input("Current value", "text", textValue(initial.value ?? initial.defaultValue));
  const defaultValue = input("Default value", "text", textValue(initial.defaultValue));
  const currentList = textarea("Current value (one selected value per line for lists)", textValue(initial.value ?? initial.defaultValue));
  const defaultList = textarea("Default value (one selected value per line for lists)", textValue(initial.defaultValue));
  const onValue = input("Checked export value", "text", initial.onValue ?? "Yes");
  const isChecked = (value: EditorFieldObject["value"]): boolean => value === true || value === (initial.onValue ?? "Yes");
  const checked = checkbox("Checked", isChecked(initial.value ?? initial.defaultValue));
  const defaultChecked = checkbox("Checked by default", isChecked(initial.defaultValue));
  const options = textarea("Options (one per line; value | label)", initial.options?.map(option => option.value === option.label ? option.value : `${option.value} | ${option.label}`).join("\n") ?? "");
  const multiSelect = checkbox("Allow multiple selections", Boolean(initial.multiSelect));
  const multiline = checkbox("Multiline text", Boolean(initial.multiline));
  const required = checkbox("Required", Boolean(initial.required)), readOnly = checkbox("Read only", Boolean(initial.readOnly));
  const maxLength = input("Maximum length (empty = unlimited)", "number", initial.maxLength === undefined ? "" : String(initial.maxLength)); maxLength.min = "1"; maxLength.step = "1";
  const fontSize = input("Font size (0 = automatic)", "number", String(initial.fontSize ?? 12)); fontSize.min = "0"; fontSize.step = "any";
  const fontWeight = input("Font weight", "number", String(initial.fontWeight === "bold" ? 700 : initial.fontWeight === "normal" ? 400 : initial.fontWeight ?? 400)); fontWeight.min = "1"; fontWeight.max = "1000"; fontWeight.step = "1";
  const italic = checkbox("Italic", initial.fontStyle === "italic" || initial.fontStyle === "oblique");
  const color = input("Text / checkmark color", "color", colorHex(initial.color ?? "#111111"));
  const fill = checkbox("Background fill", initial.fill !== null), fillColor = input("Background color", "color", colorHex(initial.fill ?? "#ffffff"));
  const borderColor = input("Border color", "color", colorHex(initial.borderColor ?? "#707070"));
  const strokeWidth = input("Border width", "number", String(initial.strokeWidth ?? 1)); strokeWidth.min = "0"; strokeWidth.step = "any";
  const align = document.createElement("select"); align.setAttribute("aria-label", "Text alignment");
  for (const value of ["left", "center", "right"]) { const option = document.createElement("option"); option.value = value; option.textContent = value[0].toUpperCase() + value.slice(1); align.append(option); }
  align.value = initial.align ?? "left"; row("Text alignment", align);
  const hint = document.createElement("p"); hint.className = "hepr-editor-field-hint";
  hint.textContent = "Radio buttons with the same field name form a group; give each a different checked export value. Number and date inputs stay ordinary editable text fields in other PDF readers.";
  const status = document.createElement("p"); status.setAttribute("role", "alert");
  const actions = document.createElement("div"); actions.className = "hepr-editor-field-actions";
  const apply = document.createElement("button"), cancel = document.createElement("button"); apply.type = cancel.type = "button"; apply.textContent = initial.id ? "Apply" : "Create field"; cancel.textContent = "Cancel"; actions.append(apply, cancel);
  dialog.append(title, grid, hint, status, actions);
  const show = (control: HTMLElement, visible: boolean): void => { control.parentElement!.hidden = !visible; };
  let usingLines: boolean | undefined;
  const update = (): void => {
    const button = type.value === "checkbox" || type.value === "radio", choice = type.value === "dropdown" || type.value === "list", many = type.value === "list" && multiSelect.checked;
    const lines = many || type.value === "text" && multiline.checked;
    if (usingLines !== undefined && lines !== usingLines) {
      if (lines) { currentList.value = current.value; defaultList.value = defaultValue.value; }
      else { current.value = currentList.value; defaultValue.value = defaultList.value; }
    }
    usingLines = lines;
    show(current, !button && !lines); show(defaultValue, !button && !lines); show(currentList, lines); show(defaultList, lines);
    show(checked, button); show(defaultChecked, button); show(onValue, button); show(options, choice); show(multiSelect, type.value === "list");
    show(multiline, type.value === "text"); show(maxLength, ["text", "email", "tel", "url"].includes(type.value));
    const nativeType = ["number", "date", "email", "tel", "url"].includes(type.value) ? type.value : "text";
    current.type = defaultValue.type = nativeType; current.step = defaultValue.step = nativeType === "number" ? "any" : "";
    fillColor.disabled = !fill.checked; status.textContent = "";
  };
  const positive = (input: HTMLInputElement, label: string, integer = false, zero = false): number => {
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || value < (zero ? 0 : 1) || integer && !Number.isSafeInteger(value)) throw new Error(`Enter a valid ${label}.`);
    return value;
  };
  const read = (): EditorFieldSettings => {
    const fieldType = type.value as EditorFieldType, button = fieldType === "checkbox" || fieldType === "radio", choice = fieldType === "dropdown" || fieldType === "list", many = fieldType === "list" && multiSelect.checked;
    if (!name.value.trim()) throw new Error("Enter a field name.");
    const exportValue = onValue.value.trim(); if (button && (!exportValue || exportValue === "Off")) throw new Error("Choose a nonempty checked export value other than Off.");
    const split = (value: string): string[] => value.split(/\r?\n/).filter(Boolean);
    const buttonValue = (control: HTMLInputElement, previous: EditorFieldObject["value"]): EditorFieldObject["value"] => control.checked ? exportValue
      : fieldType === "radio" && initial.fieldType === "radio" && previous !== undefined && !isChecked(previous) ? previous : "Off";
    const value = button ? buttonValue(checked, initial.value ?? initial.defaultValue) : many ? split(currentList.value) : usingLines ? currentList.value : current.value;
    const reset = button ? buttonValue(defaultChecked, initial.defaultValue) : many ? split(defaultList.value) : usingLines ? defaultList.value : defaultValue.value;
    const choices = choice ? parseEditorFieldOptions(options.value) : undefined;
    if (choice && !choices?.length) throw new Error("Add at least one option.");
    const { id: _id, pageIndex: _page, transform: _transform, x: _x, y: _y, width: _width, height: _height, ...retained } = initial;
    const weight = positive(fontWeight, "font weight", true); if (weight > 1000) throw new Error("Font weight must be between 1 and 1000.");
    return { ...retained, kind: "field", fieldType, name: name.value.trim(), tooltip: tooltip.value || undefined, value, defaultValue: reset,
      onValue: button ? exportValue : undefined, options: choices, multiSelect: fieldType === "list" ? multiSelect.checked : undefined,
      multiline: fieldType === "text" ? multiline.checked : undefined, readOnly: readOnly.checked, required: required.checked,
      maxLength: !maxLength.parentElement!.hidden && maxLength.value.trim() ? positive(maxLength, "maximum length", true) : undefined,
      fontSize: positive(fontSize, "font size", false, true), fontWeight: weight, fontStyle: italic.checked ? "italic" : "normal",
      color: color.value, fill: fill.checked ? fillColor.value : null, borderColor: borderColor.value,
      strokeWidth: positive(strokeWidth, "border width", false, true), align: align.value as "left" | "center" | "right" };
  };
  let closed = false, baseline: string;
  update();
  try { baseline = JSON.stringify(read()); } catch { baseline = ""; }
  const controller: EditorFieldDialog = {
    hasDraftChanges() { if (closed) return false; try { return JSON.stringify(read()) !== baseline; } catch { return true; } },
    apply() {
      if (closed) return true;
      try { onApply(read()); controller.close(); return true; }
      catch (error) { status.textContent = error instanceof Error ? error.message : "Check the field settings."; return false; }
    },
    close() { if (closed) return; closed = true; dialog.close(); dialog.remove(); onClose(); }
  };
  type.addEventListener("change", update); multiSelect.addEventListener("change", update); multiline.addEventListener("change", update); fill.addEventListener("change", update);
  apply.addEventListener("click", () => { controller.apply(); }); cancel.addEventListener("click", () => controller.close());
  dialog.addEventListener("cancel", event => { event.preventDefault(); controller.close(); });
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
  document.body.append(dialog); dialog.showModal(); name.focus();
  return controller;
}
