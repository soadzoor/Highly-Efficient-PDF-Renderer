import { toolbarButtonContent, type ToolbarIcon } from "./toolbarIcons";

/** Keep existing editor action attributes while sharing the View toolbar's SVGs. */
export function editorIconButton(kind: "tool" | "action", name: ToolbarIcon, label: string, attributes = ""): string {
  const escaped = label.replace(/[&"<>]/g, value => `&#${value.charCodeAt(0)};`);
  return `<button type="button" class="hepr-toolbar-icon-button hepr-editor-icon-button" data-${kind}="${name}" title="${escaped}" aria-label="${escaped}"${kind === "tool" ? ` aria-pressed="${name === "select"}"` : ""}${attributes ? ` ${attributes}` : ""}>${toolbarButtonContent(name, label, "hepr-toolbar-icon hepr-editor-icon")}</button>`;
}
