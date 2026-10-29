const icons = {
  select: '<path d="m5 3 14 9-7 1-3 7Z"/>',
  pan: '<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5m0-5V4a1.5 1.5 0 0 1 3 0v7m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v6c0 4-2 6-6 6h-2c-2 0-3-1-4-3l-4-5a1.5 1.5 0 0 1 2-2l2 2"/>',
  form: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M11 13h6M11 17h6m-7-4-2 2-1-1"/>',
  text: '<path d="M4 6V3h16v3M12 3v18m-4 0h8"/>',
  rectangle: '<rect x="3" y="5" width="18" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  line: '<path d="M4 20 20 4"/><circle cx="4" cy="20" r="1"/><circle cx="20" cy="4" r="1"/>',
  arrow: '<path d="m4 20 16-16M9 4h11v11"/>',
  polygon: '<path d="m12 3 9 7-4 11H7L3 10Z"/>',
  polyline: '<path d="m3 17 5-11 7 12 6-11"/><circle cx="3" cy="17" r="1"/><circle cx="21" cy="7" r="1"/>',
  ink: '<path d="m4 15-1 6 6-1L21 8l-5-5Zm9-9 5 5M4 15l5 5"/>',
  signatures: '<path d="M3 17c3-7 9-17 8-10S4 22 4 17s11-9 9-4 5 3 8-1M3 22h18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  undo: '<path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5"/>',
  redo: '<path d="M20 10H10a6 6 0 0 0 0 12m10-12-5-5m5 5-5 5"/>',
  duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 13 13M8 16 21 3"/>',
  paste: '<path d="M9 5H5v17h14V5h-4"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M8 12h8m-8 4h8"/>',
  delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  group: '<rect x="2" y="2" width="20" height="20" rx="1" stroke-dasharray="3 3"/><rect x="6" y="6" width="8" height="8"/><path d="M14 10h4v8h-8v-4"/>',
  ungroup: '<rect x="2" y="3" width="7" height="7"/><rect x="15" y="14" width="7" height="7"/><path d="m13 8 5-5m-5 0h5v5M11 16l-5 5m0-5v5h5"/>',
  font: '<path d="m3 20 5-16 5 16M5 14h6m7-2v9m-3-3 3 3 3-3M15 4h6v5"/>',
  "local-fonts": '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4M8 13l4-7 4 7m-6-2h4"/>',
  pages: '<path d="M7 3h10l4 4v14H7ZM17 3v5h4M3 7v14h1M10 12h8m-8 4h8"/>',
  layers: '<path d="m3 7 9-4 9 4-9 4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
  "add-layer": '<path d="m3 6 8-4 8 4-8 4Zm0 5 8 4 5-2M3 16l8 4m7-4h6m-3-3v6"/>',
  lock: '<rect x="5" y="10" width="14" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0m-4 9v3"/>',
  "drag-handle": '<circle cx="8" cy="5" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/>',
  "pdf-password": '<path d="M5 21H3V3h11l4 4v2M14 3v5h4"/><rect x="9" y="14" width="12" height="8" rx="2"/><path d="M12 14v-3a3 3 0 0 1 6 0v3m-3 3v2"/>',
  "save-pdf": '<path d="M4 3h13l4 4v14H3V3Zm3 0v6h10V3M7 21v-8h10v8m-3-18v3"/>',
  flatten: '<path d="m3 7 9-4 9 4-9 4Zm0 5 9 4 9-4M3 17l9 4 9-4m-9-9v10m-3-3 3 3 3-3"/>',
  "save-hep": '<path d="M4 3h13l4 4v14H3V3Zm3 0v6h10V3"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="14" r="1.5"/><circle cx="16" cy="20" r="1.5"/><path d="m9.5 16.5 5-2m-5 3 5 2"/>',
  print: '<path d="M7 8V3h10v5M7 17H3v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7h-4M7 14h10v7H7Z"/><path d="M17 11h1"/>',
  open: '<path d="M3 18V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 18l3-8h16l-3 10H5a2 2 0 0 1-2-2Z"/>',
  edit: '<path d="M13 4H3v17h17V11M9 15l1-5 8-8 4 4-8 8Zm7-11 4 4"/>',
  view: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  cancel: '<path d="m5 5 14 14M19 5 5 19"/>',
  "apply-text": '<path d="m3 13 5 5 13-13"/>',
  "cancel-text": '<path d="m5 5 14 14M19 5 5 19"/>',
  "cancel-operation": '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  "download-pdf": '<path d="M4 21h16V7l-4-4H4Zm12-18v5h4M12 10v8m-3-3 3 3 3-3"/>',
  "download-hep": '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><path d="M7 5h10M6 7l6 6 6-6m-6 6v6m-3-3 3 3 3-3M4 18v4h16v-4"/>',
  "download-all": '<path d="M6 3h13v14M3 6h13v15H3Zm7 3v8m-3-3 3 3 3-3"/>',
  thumbnails: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M10 3v18M5.5 6h2m-2 4h2m-2 4h2m-2 4h2"/>',
  previous: '<path d="m15 4-8 8 8 8"/>',
  next: '<path d="m9 4 8 8-8 8"/>',
  "zoom-in": '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M6 10h8m-4-4v8"/>',
  "zoom-out": '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M6 10h8"/>',
  "fit-width": '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M2 12h20m-17-3-3 3 3 3m14-6 3 3-3 3"/>',
  "fit-page": '<rect x="7" y="5" width="10" height="14" rx="1"/><path d="M3 8V2h6m6 0h6v6m0 8v6h-6m-6 0H3v-6"/>',
  find: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  settings: '<path d="M5 3v18M12 3v18M19 3v18"/><path d="M2 8h6m1 8h6m1-10h6" stroke-width="4"/>',
  "hide-toolbar": '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="m7 17 5-5 5 5M12 12v10"/>',
  "show-toolbar": '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="m7 16 5 5 5-5M12 11v10"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  "search-previous": '<path d="m5 16 7-8 7 8"/>',
  "search-next": '<path d="m5 8 7 8 7-8"/>',
  "match-case": '<path d="m2 20 6-16 6 16M4 15h8m10 5v-7a4 4 0 0 0-7-2m7 3h-4a3 3 0 1 0 4 3"/>',
  reader: '<rect x="5" y="2" width="14" height="8" rx="1"/><rect x="5" y="14" width="14" height="8" rx="1"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  sphere: '<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20M4 6h16M4 18h16"/>',
  helix: '<path d="M6 3c18 1 18 5 0 7s-12 6 0 7 18 3 12 5M6 3C0 4 0 7 6 8m12 3c6 1 6 4 0 5M6 18c-6 1-6 3 0 4"/>',
  examples: '<path d="M8 3h12v14M4 7h12v14H4Zm3 4h6m-6 4h6m-6 3h3"/>'
} as const;

export type ToolbarIcon = keyof typeof icons;
const escapeLabel = (label: string): string => label.replace(/[&"<>]/g, value => `&#${value.charCodeAt(0)};`);
const buttonPresentations = new WeakMap<HTMLButtonElement, { name: ToolbarIcon; label: string }>();

/** Small inline vectors shared by View and Edit; no fonts, assets or editor runtime. */
export function toolbarIconMarkup(name: ToolbarIcon, className = "hepr-toolbar-icon"): string {
  return `<svg class="${escapeLabel(className)}" data-icon="${name}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
}
export function toolbarButtonContent(name: ToolbarIcon, label: string, className?: string): string {
  return `${toolbarIconMarkup(name, className)}<span class="hepr-toolbar-button-label" aria-hidden="true">${escapeLabel(label)}</span>`;
}
export function toolbarButton(name: ToolbarIcon, label: string, attributes = "", className = ""): string {
  const escaped = escapeLabel(label);
  return `<button type="button" class="hepr-toolbar-icon-button${className ? ` ${escapeLabel(className)}` : ""}" data-toolbar-icon="${name}" title="${escaped}" aria-label="${escaped}"${attributes ? ` ${attributes}` : ""}>${toolbarButtonContent(name, label)}</button>`;
}
/** Preserve IDs, event handlers and states, and avoid rewriting unchanged button DOM. */
export function setToolbarIconButton(button: HTMLButtonElement, name: ToolbarIcon, label: string, title = label): void {
  const previous = buttonPresentations.get(button);
  // SVG DOM serialization expands self-closing paths, so markup strings are
  // not stable equality keys. Also repair icons erased by a host text update.
  if (!previous || previous.name !== name || previous.label !== label || button.firstElementChild?.getAttribute("data-icon") !== name) {
    button.innerHTML = toolbarButtonContent(name, label); buttonPresentations.set(button, { name, label });
  }
  if (!button.classList.contains("hepr-toolbar-icon-button")) button.classList.add("hepr-toolbar-icon-button");
  if (button.dataset.toolbarIcon !== name) button.dataset.toolbarIcon = name;
  if (button.title !== title) button.title = title;
  if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
}
export function initializeToolbarIcons(root: ParentNode): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-toolbar-icon]")) {
    const name = button.dataset.toolbarIcon;
    if (name && Object.prototype.hasOwnProperty.call(icons, name)) {
      const label = button.getAttribute("aria-label") || button.textContent?.trim() || button.title || name;
      setToolbarIconButton(button, name as ToolbarIcon, label, button.title || label);
    }
  }
}

