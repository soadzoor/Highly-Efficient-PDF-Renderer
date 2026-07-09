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

export function createSelectionOverlay(callbacks: SelectionOverlayCallbacks): SelectionOverlay {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:10000;";

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
    "position:absolute;pointer-events:auto;display:none;" +
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
    "position:absolute;pointer-events:auto;display:none;min-width:120px;" +
    "background:#1f2937;border-radius:8px;padding:4px;" +
    "box-shadow:0 4px 16px rgba(0,0,0,0.35);font:13px/1.2 system-ui,sans-serif;";
  contextMenu.addEventListener("contextmenu", (event) => event.preventDefault());
  contextMenu.addEventListener("pointerdown", (event) => event.stopPropagation());
  const contextMenuCopyItem = document.createElement("button");
  contextMenuCopyItem.type = "button";
  contextMenuCopyItem.textContent = "Copy";
  contextMenuCopyItem.style.cssText =
    "display:block;width:100%;text-align:left;background:none;border:none;" +
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

  function showContextMenu(clientX: number, clientY: number): void {
    contextMenu.style.display = "block";
    const menuWidth = contextMenu.offsetWidth || 120;
    const menuHeight = contextMenu.offsetHeight || 34;
    let left = Math.min(Math.max(clientX, 4), window.innerWidth - menuWidth - 4);
    let top = clientY + menuHeight + 4 > window.innerHeight ? clientY - menuHeight : clientY;
    top = Math.min(Math.max(top, 4), window.innerHeight - menuHeight - 4);
    contextMenu.style.left = `${Math.round(left)}px`;
    contextMenu.style.top = `${Math.round(top)}px`;

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
    showHandles(start: SelectionHandlePlacement, end: SelectionHandlePlacement): void {
      placeHandle(startHandle, start, "start");
      placeHandle(endHandle, end, "end");
    },

    hideHandles(): void {
      startHandle.style.display = "none";
      endHandle.style.display = "none";
    },

    showCopyButton(anchorX: number, anchorY: number): void {
      clearCopiedFlash();
      copyButton.style.display = "block";
      // Place above the anchor, clamped into the visual viewport; flip below
      // when there is no room above.
      const buttonWidth = copyButton.offsetWidth || 64;
      const buttonHeight = copyButton.offsetHeight || 30;
      let left = anchorX - buttonWidth * 0.5;
      left = Math.min(Math.max(left, COPY_BUTTON_MARGIN_PX), window.innerWidth - buttonWidth - COPY_BUTTON_MARGIN_PX);
      let top = anchorY - buttonHeight - COPY_BUTTON_MARGIN_PX;
      if (top < COPY_BUTTON_MARGIN_PX) {
        top = anchorY + COPY_BUTTON_MARGIN_PX;
      }
      top = Math.min(Math.max(top, COPY_BUTTON_MARGIN_PX), window.innerHeight - buttonHeight - COPY_BUTTON_MARGIN_PX);
      copyButton.style.left = `${Math.round(left)}px`;
      copyButton.style.top = `${Math.round(top)}px`;
    },

    hideCopyButton(): void {
      clearCopiedFlash();
      copyButton.style.display = "none";
    },

    flashCopied(): void {
      clearCopiedFlash();
      copyButton.textContent = "Copied";
      copiedFlashTimer = setTimeout(() => {
        copiedFlashTimer = null;
        copyButton.textContent = "Copy";
        copyButton.style.display = "none";
      }, 900);
    },

    showContextMenu,

    hideContextMenu,

    hide(): void {
      clearCopiedFlash();
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
