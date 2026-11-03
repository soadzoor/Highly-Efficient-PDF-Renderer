import { normalizePageNumbering, type PageNumberingSettings } from "./documentAuthoring";
import { normalizePrimitiveColor } from "./colorInput";

export function showEditorPageNumberingDialog(document: Document, options: {
  settings: PageNumberingSettings;
  apply(settings: PageNumberingSettings): void;
  onClose(): void;
}): { close(): void } {
  const dialog = document.createElement("dialog"); dialog.className = "hepr-new-pdf-dialog";
  dialog.setAttribute("aria-label", "Page numbers");
  const title = document.createElement("h2"); title.textContent = "Page numbers";
  const detail = document.createElement("p"); detail.textContent = "Numbers update automatically when pages change. Margins follow the visible page edges; a skipped first page does not consume a number.";
  dialog.append(title, detail);
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const field = (name: string, label: string, type: string, value: string | boolean): HTMLInputElement => {
    const row = document.createElement("label"), input = document.createElement("input"); row.textContent = label;
    input.type = type; input.dataset.pageNumbering = name; input.setAttribute("aria-label", label);
    if (typeof value === "boolean") input.checked = value; else input.value = value;
    row.append(input); dialog.append(row); inputs.set(name, input); return input;
  };
  const select = (name: string, label: string, values: readonly (readonly [string, string])[], value: string): void => {
    const row = document.createElement("label"), input = document.createElement("select"); row.textContent = label;
    input.dataset.pageNumbering = name; input.setAttribute("aria-label", label);
    for (const [id, text] of values) { const option = document.createElement("option"); option.value = id; option.textContent = text; input.append(option); }
    input.value = value; row.append(input); dialog.append(row); inputs.set(name, input);
  };
  const settings = options.settings;
  field("enabled", "Show page numbers", "checkbox", settings.enabled);
  field("skipFirstPage", "Skip first page (cover)", "checkbox", settings.skipFirstPage);
  const start = field("startNumber", "Starting number", "number", String(settings.startNumber)); start.min = "1"; start.step = "1";
  select("format", "Format", [["number", "1"], ["page", "Page 1"], ["page-of-total", "Page 1 of 10"]], settings.format);
  select("position", "Position", [["header", "Header"], ["footer", "Footer"]], settings.position);
  select("align", "Alignment", [["left", "Left"], ["center", "Center"], ["right", "Right"]], settings.align);
  for (const [name, label] of [["marginX", "Side margin (mm)"], ["marginY", "Top / bottom margin (mm)"]] as const) {
    const input = field(name, label, "number", String(Number((settings[name] * 25.4 / 72).toFixed(6)))); input.min = "0"; input.step = "any";
  }
  select("fontFamily", "Font", [["Liberation Sans", "Sans"], ["Liberation Serif", "Serif"], ["Liberation Mono", "Monospace"]], settings.fontFamily);
  const size = field("fontSize", "Font size (pt)", "number", String(settings.fontSize)); size.min = "0"; size.step = "any";
  const rgb = normalizePrimitiveColor(settings.color);
  field("color", "Color", "color", `#${rgb.map(channel => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`);
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const actions = document.createElement("div"); actions.className = "hepr-new-pdf-actions";
  const apply = document.createElement("button"), cancel = document.createElement("button");
  apply.type = cancel.type = "button"; apply.textContent = "Apply"; cancel.textContent = "Cancel";
  let closed = false;
  const close = (): void => { if (closed) return; closed = true; dialog.close(); dialog.remove(); options.onClose(); };
  apply.addEventListener("click", () => {
    try {
      const value = (name: string): string => inputs.get(name)!.value;
      const number = (name: string): number => value(name).trim() ? Number(value(name)) : NaN;
      const next = normalizePageNumbering({ enabled: (inputs.get("enabled") as HTMLInputElement).checked,
        skipFirstPage: (inputs.get("skipFirstPage") as HTMLInputElement).checked, startNumber: number("startNumber"),
        format: value("format") as PageNumberingSettings["format"], position: value("position") as PageNumberingSettings["position"],
        align: value("align") as PageNumberingSettings["align"], marginX: number("marginX") * 72 / 25.4, marginY: number("marginY") * 72 / 25.4,
        fontFamily: value("fontFamily") as PageNumberingSettings["fontFamily"], fontSize: number("fontSize"), color: value("color") });
      options.apply(next); close();
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  });
  cancel.addEventListener("click", close); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  actions.append(cancel, apply); dialog.append(status, actions); document.body.append(dialog); dialog.showModal(); return { close };
}
