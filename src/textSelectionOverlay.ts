/**
 * DOM overlay for the text-selection controller: two native-mobile style drag
 * handles plus a floating "Copy" button. Hand-rolled elements appended to
 * document.body (position: fixed), no dependencies; positions are client-space
 * CSS pixels supplied by the controller. Internal module — not part of the
 * public library surface.
 */

export interface SelectionOverlayCallbacks {
  onHandleDragStart(which: "start" | "end", pointerId: number): void;
  onHandleDragMove(which: "start" | "end", clientX: number, clientY: number): void;
  onHandleDragEnd(): void;
  onCopyClick(): void;
  onContextMenuCopy(): void;
}

export interface SelectionHandlePlacement {
  x: number;
  y: number;
  /** On-screen height of the selection edge the handle hangs from. */
  heightPx: number;
}

export interface SelectionOverlay {
  /** Refresh the live document viewport without rebasing client-space positions. */
  refreshViewport(): void;
  showHandles(start: SelectionHandlePlacement, end: SelectionHandlePlacement): void;
  hideHandles(): void;
  showCopyButton(anchorX: number, anchorY: number): void;
  hideCopyButton(): void;
  /** Brief "Copied" feedback, then the popup hides. */
  flashCopied(): void;
  /** Show the right-click context menu at a client-space point (clamped). */
  showContextMenu(clientX: number, clientY: number): void;
  hideContextMenu(): void;
  hide(): void;
  dispose(): void;
}

const HANDLE_SIZE_PX = 22;
const HANDLE_COLOR = "#4285f4";
const COPY_BUTTON_MARGIN_PX = 8;
type SelectionViewport = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">;

export function createSelectionOverlay(callbacks: SelectionOverlayCallbacks,
  getViewport?: () => SelectionViewport | null): SelectionOverlay {
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:20;" +
    "user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;";

  const makeHandle = (which: "start" | "end"): HTMLDivElement => {
    const handle = document.createElement("div");
    // Teardrop: a circle with one squared-off corner pointing at the text.
    // The start handle points up-right (drop hangs left), the end handle
    // up-left (drop hangs right), like native mobile selection handles.
    const squareCorner = which === "start" ? "border-top-right-radius:0;" : "border-top-left-radius:0;";
    handle.style.cssText =
      `position:absolute;width:${HANDLE_SIZE_PX}px;height:${HANDLE_SIZE_PX}px;` +
      `background:${HANDLE_COLOR};border-radius:50%;${squareCorner}` +
      "pointer-events:auto;touch-action:none;cursor:grab;display:none;" +
      "box-shadow:0 1px 3px rgba(0,0,0,0.4);";
    let activePointerId: number | null = null;
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activePointerId = event.pointerId;
      handle.setPointerCapture(event.pointerId);
      callbacks.onHandleDragStart(which, event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (activePointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      callbacks.onHandleDragMove(which, event.clientX, event.clientY);
    });
    const endDrag = (event: PointerEvent): void => {
      if (activePointerId !== event.pointerId) {
        return;
      }
      activePointerId = null;
      event.stopPropagation();
      callbacks.onHandleDragEnd();
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    container.appendChild(handle);
    return handle;
  };

  const startHandle = makeHandle("start");
  const endHandle = makeHandle("end");

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy";
  copyButton.style.cssText =
    "position:absolute;pointer-events:auto;display:none;box-sizing:border-box;min-width:0;min-height:0;overflow:hidden;" +
    "background:#1f2937;color:#fff;border:none;border-radius:16px;" +
    "padding:6px 14px;font:13px/1.2 system-ui,sans-serif;cursor:pointer;" +
    "box-shadow:0 2px 8px rgba(0,0,0,0.35);touch-action:none;";
  // Keep the press from reaching the canvas (would clear the selection).
  copyButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  copyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    callbacks.onCopyClick();
  });
  container.appendChild(copyButton);

  // Custom right-click context menu for the selection (native menus cannot
  // offer "Copy" for canvas-rendered text).
  const contextMenu = document.createElement("div");
  contextMenu.style.cssText =
    "position:absolute;pointer-events:auto;display:none;min-width:120px;min-height:0;box-sizing:border-box;overflow:auto;" +
    "background:#1f2937;border-radius:8px;padding:4px;" +
    "box-shadow:0 4px 16px rgba(0,0,0,0.35);font:13px/1.2 system-ui,sans-serif;";
  contextMenu.addEventListener("contextmenu", (event) => event.preventDefault());
  contextMenu.addEventListener("pointerdown", (event) => event.stopPropagation());
  const contextMenuCopyItem = document.createElement("button");
  contextMenuCopyItem.type = "button";
  contextMenuCopyItem.textContent = "Copy";
  contextMenuCopyItem.style.cssText =
    "display:block;width:100%;min-width:0;box-sizing:border-box;text-align:left;background:none;border:none;" +
    "color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font:inherit;";
  contextMenuCopyItem.addEventListener("mouseenter", () => {
    contextMenuCopyItem.style.background = "rgba(255,255,255,0.12)";
  });
  contextMenuCopyItem.addEventListener("mouseleave", () => {
    contextMenuCopyItem.style.background = "none";
  });
  contextMenuCopyItem.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  contextMenuCopyItem.addEventListener("click", (event) => {
    event.stopPropagation();
    hideContextMenu();
    callbacks.onContextMenuCopy();
  });
  contextMenu.appendChild(contextMenuCopyItem);
  container.appendChild(contextMenu);

  // Native-menu style dismissal: any outside press, wheel, Escape, or window
  // blur closes the menu. Listeners exist only while the menu is open.
  let contextMenuDismiss: AbortController | null = null;
  let copyAnchor: { x: number; y: number } | null = null;
  let contextPoint: { x: number; y: number } | null = null;
  let viewport: SelectionViewport = { left: 0, top: 0, right: 0, bottom: 0 };

  const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
  function popupBounds(margin: number): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    const width = viewport.right - viewport.left, height = viewport.bottom - viewport.top;
    const xMargin = width > margin * 2 ? margin : 0, yMargin = height > margin * 2 ? margin : 0;
    return { left: viewport.left + xMargin, top: viewport.top + yMargin, right: viewport.right - xMargin,
      bottom: viewport.bottom - yMargin, width: Math.max(0, width - xMargin * 2), height: Math.max(0, height - yMargin * 2) };
  }
  function positionCopyButton(): void {
    if (!copyAnchor) return;
    const bounds = popupBounds(COPY_BUTTON_MARGIN_PX);
    copyButton.style.maxWidth = `${bounds.width}px`; copyButton.style.maxHeight = `${bounds.height}px`;
    copyButton.style.paddingLeft = copyButton.style.paddingRight = `${Math.min(14, bounds.width / 4)}px`;
    copyButton.style.paddingTop = copyButton.style.paddingBottom = `${Math.min(6, bounds.height / 4)}px`;
    const width = Math.min(copyButton.offsetWidth || 64, bounds.width), height = Math.min(copyButton.offsetHeight || 30, bounds.height);
    const left = clamp(copyAnchor.x - width * .5, bounds.left, bounds.right - width);
    let top = copyAnchor.y - height - COPY_BUTTON_MARGIN_PX;
    if (top < bounds.top) top = copyAnchor.y + COPY_BUTTON_MARGIN_PX;
    top = clamp(top, bounds.top, bounds.bottom - height);
    copyButton.style.left = `${clamp(Math.round(left), bounds.left, bounds.right - width)}px`;
    copyButton.style.top = `${clamp(Math.round(top), bounds.top, bounds.bottom - height)}px`;
  }
  function positionContextMenu(): void {
    if (!contextPoint) return;
    const bounds = popupBounds(4);
    contextMenu.style.minWidth = `${Math.min(120, bounds.width)}px`;
    contextMenu.style.maxWidth = `${bounds.width}px`; contextMenu.style.maxHeight = `${bounds.height}px`;
    const padding = Math.min(4, bounds.width / 4, bounds.height / 4);
    contextMenu.style.padding = `${padding}px`;
    contextMenuCopyItem.style.paddingLeft = contextMenuCopyItem.style.paddingRight = `${Math.min(14, Math.max(0, bounds.width - padding * 2) / 4)}px`;
    contextMenuCopyItem.style.paddingTop = contextMenuCopyItem.style.paddingBottom = `${Math.min(6, Math.max(0, bounds.height - padding * 2) / 4)}px`;
    const width = Math.min(contextMenu.offsetWidth || 120, bounds.width), height = Math.min(contextMenu.offsetHeight || 34, bounds.height);
    const left = clamp(contextPoint.x, bounds.left, bounds.right - width);
    const preferredTop = contextPoint.y + height + 4 > viewport.bottom ? contextPoint.y - height : contextPoint.y;
    const top = clamp(preferredTop, bounds.top, bounds.bottom - height);
    contextMenu.style.left = `${clamp(Math.round(left), bounds.left, bounds.right - width)}px`;
    contextMenu.style.top = `${clamp(Math.round(top), bounds.top, bounds.bottom - height)}px`;
  }
  function refreshViewport(): void {
    const width = Math.max(0, window.innerWidth), height = Math.max(0, window.innerHeight);
    const requested = getViewport ? getViewport() : { left: 0, top: 0, right: width, bottom: height };
    if (!requested || ![requested.left, requested.top, requested.right, requested.bottom].every(Number.isFinite)) {
      viewport = { left: 0, top: 0, right: 0, bottom: 0 };
    } else {
      const left = clamp(requested.left, 0, width), top = clamp(requested.top, 0, height);
      viewport = { left, top, right: clamp(requested.right, left, width), bottom: clamp(requested.bottom, top, height) };
    }
    const clip = `inset(${viewport.top}px ${width - viewport.right}px ${height - viewport.bottom}px ${viewport.left}px)`;
    if (container.style.clipPath !== clip) container.style.clipPath = clip;
    const visibility = viewport.right > viewport.left && viewport.bottom > viewport.top ? "visible" : "hidden";
    if (container.style.visibility !== visibility) container.style.visibility = visibility;
    if (copyAnchor) positionCopyButton();
    if (contextPoint) positionContextMenu();
  }

  function showContextMenu(clientX: number, clientY: number): void {
    contextPoint = { x: clientX, y: clientY };
    contextMenu.style.display = "block";
    refreshViewport();

    if (!contextMenuDismiss) {
      contextMenuDismiss = new AbortController();
      const signal = contextMenuDismiss.signal;
      window.addEventListener(
        "pointerdown",
        (event) => {
          if (!(event.target instanceof Node) || !contextMenu.contains(event.target)) {
            hideContextMenu();
          }
        },
        { capture: true, signal }
      );
      window.addEventListener("wheel", () => hideContextMenu(), { capture: true, passive: true, signal });
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") {
            hideContextMenu();
          }
        },
        { signal }
      );
      window.addEventListener("blur", () => hideContextMenu(), { signal });
    }
  }

  function hideContextMenu(): void {
    contextPoint = null;
    contextMenu.style.display = "none";
    contextMenuDismiss?.abort();
    contextMenuDismiss = null;
  }

  document.body.appendChild(container);

  let copiedFlashTimer: ReturnType<typeof setTimeout> | null = null;

  const clearCopiedFlash = (): void => {
    if (copiedFlashTimer !== null) {
      clearTimeout(copiedFlashTimer);
      copiedFlashTimer = null;
    }
    copyButton.textContent = "Copy";
  };

  const placeHandle = (handle: HTMLDivElement, placement: SelectionHandlePlacement, which: "start" | "end"): void => {
    // Anchor the squared corner (the tip) at the selection edge's bottom.
    const tipOffsetX = which === "start" ? HANDLE_SIZE_PX : 0;
    handle.style.left = `${Math.round(placement.x - tipOffsetX)}px`;
    handle.style.top = `${Math.round(placement.y)}px`;
    handle.style.display = "block";
  };

  return {
    refreshViewport,
    showHandles(start: SelectionHandlePlacement, end: SelectionHandlePlacement): void {
      refreshViewport();
      placeHandle(startHandle, start, "start");
      placeHandle(endHandle, end, "end");
    },

    hideHandles(): void {
      startHandle.style.display = "none";
      endHandle.style.display = "none";
    },

    showCopyButton(anchorX: number, anchorY: number): void {
      clearCopiedFlash();
      copyAnchor = { x: anchorX, y: anchorY };
      copyButton.style.display = "block";
      refreshViewport();
    },

    hideCopyButton(): void {
      clearCopiedFlash();
      copyAnchor = null;
      copyButton.style.display = "none";
    },

    flashCopied(): void {
      clearCopiedFlash();
      copyButton.textContent = "Copied";
      refreshViewport();
      copiedFlashTimer = setTimeout(() => {
        copiedFlashTimer = null;
        copyAnchor = null;
        copyButton.textContent = "Copy";
        copyButton.style.display = "none";
      }, 900);
    },

    showContextMenu,

    hideContextMenu,

    hide(): void {
      clearCopiedFlash();
      copyAnchor = null;
      startHandle.style.display = "none";
      endHandle.style.display = "none";
      copyButton.style.display = "none";
      hideContextMenu();
    },

    dispose(): void {
      clearCopiedFlash();
      hideContextMenu();
      container.remove();
    }
  };
}
