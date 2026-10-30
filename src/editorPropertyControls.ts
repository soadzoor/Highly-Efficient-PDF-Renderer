import type { EditorSession } from "./editorTypes";
import { editorPropertyState, type EditorAppearanceProperty } from "./editorProperties";

const controls: readonly [string, EditorAppearanceProperty][] = [["color", "color"], ["stroke", "strokeWidth"], ["fill", "fill"],
  ["font", "fontId"], ["font-size", "fontSize"], ["align", "align"]];
const styles: readonly [string, EditorAppearanceProperty][] = [["bold", "fontWeight"], ["italic", "fontStyle"], ["underline", "underline"], ["strikethrough", "strikethrough"]];

/** Contextual readback lives outside gesture/publication state and is never run per pointer pose. */
export function createEditorPropertyControls(options: {
  session: EditorSession;
  control(name: string): HTMLInputElement | HTMLSelectElement;
  style(name: string): HTMLButtonElement;
  focused(): Element | null;
  note: HTMLElement;
}) {
  let selectionMode = false, selectionKey = "";
  const defaults = new Map<string, string>(), defaultStyles = new Map<string, string>();
  for (const [name] of controls) defaults.set(name, options.control(name).value);
  for (const [name] of styles) defaultStyles.set(name, options.style(name).getAttribute("aria-pressed") ?? "false");
  const fillEnabled = options.control("fill-enabled") as HTMLInputElement;
  let defaultFillEnabled = fillEnabled.checked;
  function mixed(control: HTMLElement, value: boolean): void {
    control.dataset.mixed = String(value);
    if (value) control.setAttribute("aria-description", "Mixed values; changing this control applies to supported objects in the selection.");
    else control.removeAttribute("aria-description");
  }
  return { refresh(mode: "selection" | "draft" | "defaults") {
    if (mode === "draft") {
      for (const [name] of controls) {
        const control = options.control(name); control.disabled = name === "stroke" || name === "fill";
        if (control.tagName === "SELECT") control.querySelector('option[data-mixed]')?.remove();
        if ("placeholder" in control) control.placeholder = ""; mixed(control, false);
      }
      fillEnabled.disabled = true; fillEnabled.indeterminate = false; options.note.textContent = "";
      for (const [name] of styles) options.style(name).disabled = false;
      return;
    }
    if (mode === "defaults") {
      for (const [name] of controls) {
        const control = options.control(name); control.disabled = false;
        if (control.tagName === "SELECT") control.querySelector('option[data-mixed]')?.remove();
        if (selectionMode) control.value = defaults.get(name)!; else defaults.set(name, control.value);
        if ("placeholder" in control) control.placeholder = ""; mixed(control, false);
      }
      for (const [name] of styles) {
        const button = options.style(name); button.disabled = false;
        if (selectionMode) button.setAttribute("aria-pressed", defaultStyles.get(name)!);
        else defaultStyles.set(name, button.getAttribute("aria-pressed") ?? "false");
      }
      if (selectionMode) fillEnabled.checked = defaultFillEnabled; else defaultFillEnabled = fillEnabled.checked;
      fillEnabled.disabled = false; fillEnabled.indeterminate = false; options.note.textContent = ""; selectionMode = false; selectionKey = ""; return;
    }
    if (!selectionMode) {
      for (const [name] of controls) defaults.set(name, options.control(name).value);
      for (const [name] of styles) defaultStyles.set(name, options.style(name).getAttribute("aria-pressed") ?? "false");
      defaultFillEnabled = fillEnabled.checked;
    }
    selectionMode = true;
    const key = JSON.stringify(options.session.getSelection()), selectionChanged = key !== selectionKey; selectionKey = key;
    const editable = new Set<string>(); let total = 0;
    for (const [name, property] of controls) {
      const state = editorPropertyState(options.session, property), control = options.control(name);
      state.ids.forEach(id => editable.add(id)); total = state.total; control.disabled = !state.ids.length;
      mixed(control, state.mixed);
      if (!selectionChanged && options.focused() === control) continue;
      if ("placeholder" in control) control.placeholder = state.mixed ? "Mixed" : "";
      if (control.tagName === "SELECT") {
        const select = control as HTMLSelectElement;
        select.querySelector('option[data-mixed]')?.remove();
        if (state.mixed) { const option = select.ownerDocument.createElement("option"); option.value = "__mixed__"; option.dataset.mixed = "true"; option.textContent = "Mixed"; option.disabled = true; select.prepend(option); }
        select.value = state.mixed ? "__mixed__" : String(state.value ?? "");
      } else if (name === "color" || name === "fill") { if (!state.mixed && state.value != null) control.value = String(state.value); }
      else control.value = state.mixed ? "" : String(state.value ?? "");
    }
    const fill = editorPropertyState(options.session, "fill"), flags = fill.values.map(value => value !== null);
    fillEnabled.disabled = !fill.ids.length; fillEnabled.indeterminate = flags.some(value => value !== flags[0]); fillEnabled.checked = flags[0] ?? false;
    for (const [name, property] of styles) {
      const state = editorPropertyState(options.session, property), button = options.style(name);
      button.disabled = !state.ids.length; button.setAttribute("aria-pressed", state.mixed ? "mixed" : String(Boolean(state.value)));
    }
    options.note.textContent = !editable.size ? options.session.getSelection().some(id => options.session.isObjectLocked?.(id))
      ? "This selection is locked. Unlock it to edit." : "This selection supports transforms; appearance controls apply to added objects."
      : editable.size < total ? `Appearance changes apply to ${editable.size} supported ${editable.size === 1 ? "object" : "objects"} in this selection.` : "";
  } };
}
