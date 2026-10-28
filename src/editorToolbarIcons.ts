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
  delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  group: '<rect x="2" y="2" width="20" height="20" rx="1" stroke-dasharray="3 3"/><rect x="6" y="6" width="8" height="8"/><path d="M14 10h4v8h-8v-4"/>',
  ungroup: '<rect x="2" y="3" width="7" height="7"/><rect x="15" y="14" width="7" height="7"/><path d="m13 8 5-5m-5 0h5v5M11 16l-5 5m0-5v5h5"/>',
  font: '<path d="m3 20 5-16 5 16M5 14h6m7-2v9m-3-3 3 3 3-3M15 4h6v5"/>',
  "local-fonts": '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4M8 13l4-7 4 7m-6-2h4"/>'
} as const;

/** Inline vectors keep toolbar icons sharp without an icon font or extra requests. */
export function editorIconButton(kind: "tool" | "action", name: keyof typeof icons, label: string): string {
  const escaped = label.replace(/[&"<>]/g, value => `&#${value.charCodeAt(0)};`);
  return `<button type="button" class="hepr-editor-icon-button" data-${kind}="${name}" title="${escaped}" aria-label="${escaped}"${kind === "tool" ? ` aria-pressed="${name === "select"}"` : ""}><svg class="hepr-editor-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg></button>`;
}
