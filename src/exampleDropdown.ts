export interface ExampleDropdownAction {
  key: string;
  label: string;
  sizeLabel: string;
  title: string;
}

export interface ExampleDropdownItem {
  name: string;
  actions: ExampleDropdownAction[];
}

export interface ExampleDropdownController {
  setPlaceholder(text: string): void;
  setItems(items: ExampleDropdownItem[]): void;
  setDisabled(disabled: boolean): void;
  close(): void;
}

interface ExampleDropdownOptions {
  containerElement: HTMLElement;
  triggerElement: HTMLButtonElement;
  labelElement: HTMLElement;
  menuElement: HTMLElement;
  onSelect: (selectionKey: string) => void;
  signal?: AbortSignal;
}

const MENU_VIEWPORT_MARGIN_PX = 16;
const MENU_TRIGGER_GAP_PX = 6;

export function createExampleDropdown(options: ExampleDropdownOptions): ExampleDropdownController {
  const { containerElement, triggerElement, labelElement, menuElement, onSelect, signal } = options;
  const listenerOptions = signal ? { signal } : undefined;

  let hasItems = false;
  let hostDisabled = false;
  let isOpen = false;

  menuElement.tabIndex = -1;
  // The HUD panel clips fixed-position descendants (backdrop-filter creates a
  // containing block and the panel scrolls), so host the menu on <body>.
  document.body.append(menuElement);

  function ownsNode(node: Node): boolean {
    return containerElement.contains(node) || menuElement.contains(node);
  }

  function refreshDisabledState(): void {
    const disabled = hostDisabled || !hasItems;
    triggerElement.disabled = disabled;
    if (disabled) {
      closeMenu();
    }
  }

  function openMenu(): void {
    if (isOpen || triggerElement.disabled) {
      return;
    }
    isOpen = true;
    menuElement.hidden = false;
    positionMenu();
    containerElement.classList.add("open");
    triggerElement.setAttribute("aria-expanded", "true");
    menuElement.focus({ preventScroll: true });
  }

  function closeMenu(restoreFocus = false): void {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    menuElement.hidden = true;
    containerElement.classList.remove("open");
    triggerElement.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
      triggerElement.focus();
    }
  }

  function positionMenu(): void {
    const triggerRect = triggerElement.getBoundingClientRect();
    menuElement.style.minWidth = `${Math.round(triggerRect.width)}px`;
    menuElement.style.top = `${Math.round(triggerRect.bottom + MENU_TRIGGER_GAP_PX)}px`;
    menuElement.style.left = `${Math.round(triggerRect.left)}px`;
    const availableBelow = window.innerHeight - triggerRect.bottom - MENU_TRIGGER_GAP_PX - MENU_VIEWPORT_MARGIN_PX;
    menuElement.style.maxHeight = `${Math.max(160, availableBelow)}px`;

    const menuRect = menuElement.getBoundingClientRect();
    const overflowRight = menuRect.right - (window.innerWidth - MENU_VIEWPORT_MARGIN_PX);
    if (overflowRight > 0) {
      menuElement.style.left = `${Math.max(MENU_VIEWPORT_MARGIN_PX, Math.round(menuRect.left - overflowRight))}px`;
    }
  }

  function getActionButtons(): HTMLButtonElement[] {
    return Array.from(menuElement.querySelectorAll<HTMLButtonElement>("button.example-chip"));
  }

  function moveFocus(step: number): void {
    const buttons = getActionButtons();
    if (buttons.length === 0) {
      return;
    }
    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = activeIndex === -1
      ? (step > 0 ? 0 : buttons.length - 1)
      : (activeIndex + step + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
  }

  triggerElement.addEventListener("click", () => {
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }, listenerOptions);

  triggerElement.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    }
  }, listenerOptions);

  menuElement.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const buttons = getActionButtons();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    }
  }, listenerOptions);

  const handleFocusOut = (event: FocusEvent): void => {
    const nextFocus = event.relatedTarget;
    if (nextFocus instanceof Node && ownsNode(nextFocus)) {
      return;
    }
    closeMenu();
  };
  containerElement.addEventListener("focusout", handleFocusOut, listenerOptions);
  menuElement.addEventListener("focusout", handleFocusOut, listenerOptions);

  document.addEventListener("pointerdown", (event) => {
    if (isOpen && event.target instanceof Node && !ownsNode(event.target)) {
      closeMenu();
    }
  }, listenerOptions);

  window.addEventListener("resize", () => {
    closeMenu();
  }, listenerOptions);

  window.addEventListener(
    "scroll",
    (event) => {
      if (isOpen && event.target instanceof Node && !menuElement.contains(event.target)) {
        closeMenu();
      }
    },
    { capture: true, passive: true, ...(signal ? { signal } : {}) }
  );

  function setPlaceholder(text: string): void {
    hasItems = false;
    labelElement.textContent = text;
    menuElement.replaceChildren();
    refreshDisabledState();
  }

  function setItems(items: ExampleDropdownItem[]): void {
    hasItems = items.length > 0;
    labelElement.replaceChildren();
    labelElement.append("Examples");
    if (hasItems) {
      const countBadge = document.createElement("span");
      countBadge.className = "example-trigger-count";
      countBadge.textContent = String(items.length);
      labelElement.append(countBadge);
    }

    const rows: HTMLElement[] = [];
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "example-menu-row";

      const name = document.createElement("span");
      name.className = "example-menu-name";
      name.textContent = item.name;
      name.title = item.name;
      row.append(name);

      const actions = document.createElement("div");
      actions.className = "example-menu-actions";
      for (const action of item.actions) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "example-chip";
        chip.title = action.title;

        const kind = document.createElement("span");
        kind.className = "example-chip-kind";
        kind.textContent = action.label;
        const size = document.createElement("span");
        size.className = "example-chip-size";
        size.textContent = action.sizeLabel;
        chip.append(kind, size);

        chip.addEventListener("click", () => {
          closeMenu();
          onSelect(action.key);
        });
        actions.append(chip);
      }
      row.append(actions);
      rows.push(row);
    }
    menuElement.replaceChildren(...rows);
    refreshDisabledState();
  }

  function setDisabled(disabled: boolean): void {
    hostDisabled = disabled;
    refreshDisabledState();
  }

  return {
    setPlaceholder,
    setItems,
    setDisabled,
    close: () => closeMenu()
  };
}
