import type { EditorStackingAction } from "./editorTypes";

export interface EditorContextMenu {
  show(point: { x: number; y: number }): void;
  close(): void;
  dispose(): void;
}

const actions: readonly { action: EditorStackingAction; label: string }[] = [
  { action: "bring-to-front", label: "Bring to front" },
  { action: "bring-forward", label: "Bring forward" },
  { action: "send-backward", label: "Send backward" },
  { action: "send-to-back", label: "Send to back" }
];

/** Mounted only while open; closed menus do not observe document events or frames. */
export function createEditorContextMenu(document: Document, options: {
  canRun(action: EditorStackingAction): boolean;
  run(action: EditorStackingAction): void | Promise<void>;
  onError?(error: unknown): void;
}): EditorContextMenu {
  const window = document.defaultView;
  const menu = document.createElement("div"); menu.className = "hepr-editor-context-menu"; menu.hidden = true; menu.tabIndex = -1;
  menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "Drawing order within layer");
  const buttons = actions.map(({ action, label }) => {
    const button = document.createElement("button"); button.type = "button"; button.tabIndex = -1;
    button.dataset.stackAction = action; button.textContent = label; button.title = `${label} within the layer`;
    button.setAttribute("role", "menuitem"); menu.append(button); return button;
  });
  const lifetime = new AbortController();
  let open = false, disposed = false, dismissal: AbortController | null = null, previous: HTMLElement | null = null;
  function hide(restoreFocus: boolean): void {
    if (!open) return;
    const restore = restoreFocus && menu.contains(document.activeElement);
    open = false; dismissal?.abort(); dismissal = null; menu.hidden = true; menu.remove();
    const target = previous; previous = null;
    if (restore && target?.isConnected) target.focus({ preventScroll: true });
  }
  function outside(event: Event): void {
    if (!menu.contains(event.target as Node | null)) hide(false);
  }
  function position(point: { x: number; y: number }): void {
    const viewport = window?.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = Math.max(0, viewport?.width ?? window?.innerWidth ?? document.documentElement.clientWidth);
    const height = Math.max(0, viewport?.height ?? window?.innerHeight ?? document.documentElement.clientHeight);
    const margin = Math.min(4, width / 2, height / 2), availableWidth = width - margin * 2, availableHeight = height - margin * 2;
    menu.style.minWidth = `${Math.min(180, availableWidth)}px`;
    menu.style.maxWidth = `${availableWidth}px`; menu.style.maxHeight = `${availableHeight}px`;
    const rect = menu.getBoundingClientRect(), menuWidth = Math.min(rect.width, availableWidth), menuHeight = Math.min(rect.height, availableHeight);
    const x = Number.isFinite(point.x) ? point.x : left, y = Number.isFinite(point.y) ? point.y : top;
    const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
    menu.style.left = `${clamp(x, left + margin, left + width - margin - menuWidth)}px`;
    menu.style.top = `${clamp(y + menuHeight > top + height - margin ? y - menuHeight : y, top + margin, top + height - margin - menuHeight)}px`;
  }
  menu.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-stack-action]");
    if (!open || !button || button.disabled) return;
    event.stopPropagation();
    const action = actions.find(item => item.action === button.dataset.stackAction)?.action;
    if (!action) return;
    try {
      // Selection/history may have changed while the menu was open.
      if (!options.canRun(action)) { hide(true); return; }
      hide(true); void Promise.resolve(options.run(action)).catch(error => options.onError?.(error));
    } catch (error) { hide(true); options.onError?.(error); }
  }, { signal: lifetime.signal });
  menu.addEventListener("pointerdown", event => event.stopPropagation(), { signal: lifetime.signal });
  menu.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); }, { signal: lifetime.signal });
  function keydown(event: KeyboardEvent): void {
    if (!open) return;
    const navigation = ["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab"];
    if ((event.ctrlKey || event.metaKey) && !navigation.includes(event.key) &&
        !["Delete", "Backspace", "Control", "Meta", "Shift", "Alt"].includes(event.key)) {
      // Let the host's save/undo shortcuts handle the original event instead
      // of exposing the browser's default save-page action behind this menu.
      hide(true); return;
    }
    event.stopPropagation();
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); return; }
    if (event.key === "Tab") { hide(true); return; }
    if (event.key === "Escape") { event.preventDefault(); hide(true); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = buttons.filter(button => !button.disabled); if (!enabled.length) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : event.key === "ArrowDown"
      ? (current + 1) % enabled.length : (current < 0 ? enabled.length - 1 : current + enabled.length - 1) % enabled.length;
    enabled[index].focus({ preventScroll: true });
  }
  menu.addEventListener("keydown", keydown, { signal: lifetime.signal });
  return {
    show(point) {
      if (disposed) return;
      const restoreTo = open ? previous : document.activeElement as HTMLElement | null;
      hide(false);
      try { buttons.forEach((button, index) => { button.disabled = !options.canRun(actions[index].action); }); }
      catch (error) { if (restoreTo?.isConnected) restoreTo.focus({ preventScroll: true }); options.onError?.(error); return; }
      previous = restoreTo; open = true; menu.hidden = false; document.body.append(menu); position(point);
      dismissal = new AbortController(); const signal = dismissal.signal;
      window?.addEventListener("pointerdown", outside, { capture: true, signal });
      window?.addEventListener("contextmenu", outside, { capture: true, signal });
      window?.addEventListener("wheel", outside, { capture: true, passive: true, signal });
      window?.addEventListener("scroll", outside, { capture: true, passive: true, signal });
      window?.addEventListener("focusin", outside, { signal });
      window?.addEventListener("resize", () => hide(true), { signal });
      window?.addEventListener("blur", () => hide(false), { signal });
      window?.addEventListener("keydown", event => {
        if (event.key === "Escape" || menu.contains(event.target as Node | null) || menu.contains(document.activeElement)) keydown(event);
      }, { capture: true, signal });
      (buttons.find(button => !button.disabled) ?? menu).focus({ preventScroll: true });
    },
    close: () => hide(true),
    dispose() { if (disposed) return; hide(true); disposed = true; lifetime.abort(); menu.remove(); }
  };
}
