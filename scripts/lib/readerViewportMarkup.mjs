import { toolbarButton } from "../../src/toolbarIcons.ts";

/** Rendered into the initial viewer HTML by Vite; runtime only binds these controls. */
export function readerNavigationMarkup() {
  return `<label class="reader-layout-label">Layout <select class="reader-layout" aria-label="Page layout"></select></label>
    <div class="reader-reading-controls">
      ${toolbarButton("thumbnails", "Toggle page thumbnails", 'data-reader="thumbnails" aria-expanded="false"')}
      ${toolbarButton("previous", "Previous page", 'data-reader="previous"')}
      <input class="reader-page-number" type="number" min="1" value="1" aria-label="Page number" />
      <span class="reader-page-count">/ 0</span>
      ${toolbarButton("next", "Next page", 'data-reader="next"')}
      ${toolbarButton("zoom-out", "Zoom out", 'data-reader="zoom-out"')}
      <input class="reader-zoom" type="text" inputmode="decimal" value="100%" aria-label="Zoom percentage" />
      ${toolbarButton("zoom-in", "Zoom in", 'data-reader="zoom-in"')}
      ${toolbarButton("fit-width", "Fit Width", 'data-reader="fit-width"')}
      ${toolbarButton("fit-page", "Fit Page", 'data-reader="fit-page"')}
    </div>
    ${toolbarButton("find", "Find text in the document (Ctrl/Cmd+F)", 'data-reader="find"')}
    ${toolbarButton("settings", "Settings", 'data-reader="settings"')}
    ${toolbarButton("hide-toolbar", "Hide toolbar", 'data-reader="hide-toolbar" aria-controls="reader-toolbar" aria-expanded="true"')}
    <span class="reader-announcement" role="status" aria-live="polite"></span>`;
}

export function readerToolbarRestoreMarkup() {
  return toolbarButton("show-toolbar", "Show toolbar", 'data-reader="show-toolbar" aria-controls="reader-toolbar" aria-expanded="false" hidden', "reader-toolbar-restore");
}
