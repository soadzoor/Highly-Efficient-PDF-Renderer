import type { TextSearchState } from "./textSearch";

export type TextSearchAvailability = "ready" | "no-scene" | "no-text-index";

export interface TextSearchWidgetElements {
  input: HTMLInputElement;
  prevButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
  caseButton: HTMLButtonElement;
  countLabel: HTMLElement;
}

export interface TextSearchWidgetCallbacks {
  onQueryInput: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onCaseToggle: (enabled: boolean) => void;
  onClose: () => void;
}

export interface TextSearchWidget {
  applyState(state: TextSearchState): void;
  setAvailability(availability: TextSearchAvailability): void;
  focusInput(): void;
  isAvailable(): boolean;
}

const QUERY_DEBOUNCE_MS = 150;

const PLACEHOLDER_BY_AVAILABILITY: Record<TextSearchAvailability, string> = {
  ready: "Find in document...",
  "no-scene": "Load a document to search",
  "no-text-index": "No text data in this ZIP - re-export to enable search"
};

export function createTextSearchWidget(
  elements: TextSearchWidgetElements,
  callbacks: TextSearchWidgetCallbacks
): TextSearchWidget {
  let availability: TextSearchAvailability = "no-scene";
  let hasMatches = false;
  let debounceHandle = 0;
  let lastSentQuery = "";

  const sendQueryIfChanged = (): boolean => {
    window.clearTimeout(debounceHandle);
    if (elements.input.value === lastSentQuery) {
      return false;
    }
    lastSentQuery = elements.input.value;
    callbacks.onQueryInput(lastSentQuery);
    return true;
  };

  elements.input.addEventListener("input", () => {
    window.clearTimeout(debounceHandle);
    debounceHandle = window.setTimeout(() => {
      sendQueryIfChanged();
    }, QUERY_DEBOUNCE_MS);
  });

  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      // A fresh query already selects and reveals the nearest match; only
      // step when the query was already submitted (browser-find behavior).
      if (!sendQueryIfChanged()) {
        if (event.shiftKey) {
          callbacks.onPrev();
        } else {
          callbacks.onNext();
        }
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(debounceHandle);
      elements.input.value = "";
      lastSentQuery = "";
      callbacks.onClose();
      elements.input.blur();
    } else if (!event.ctrlKey && !event.metaKey) {
      // Keep plain typing away from app-level shortcuts, but let modifier
      // combos (e.g. Ctrl/Cmd+F) bubble to the global handler.
      event.stopPropagation();
    }
  });

  elements.prevButton.addEventListener("click", () => {
    if (!sendQueryIfChanged()) {
      callbacks.onPrev();
    }
  });

  elements.nextButton.addEventListener("click", () => {
    if (!sendQueryIfChanged()) {
      callbacks.onNext();
    }
  });

  elements.caseButton.addEventListener("click", () => {
    sendQueryIfChanged();
    const enabled = elements.caseButton.getAttribute("aria-pressed") !== "true";
    elements.caseButton.setAttribute("aria-pressed", enabled ? "true" : "false");
    callbacks.onCaseToggle(enabled);
  });

  const applyDisabledStates = (): void => {
    const ready = availability === "ready";
    elements.input.disabled = !ready;
    elements.caseButton.disabled = !ready;
    elements.prevButton.disabled = !ready || !hasMatches;
    elements.nextButton.disabled = !ready || !hasMatches;
  };

  return {
    applyState(state: TextSearchState): void {
      hasMatches = state.matchCount > 0;
      elements.caseButton.setAttribute("aria-pressed", state.caseSensitive ? "true" : "false");

      const showCount = availability === "ready" && state.query.trim().length > 0;
      elements.countLabel.hidden = !showCount;
      if (showCount) {
        const total = state.matchCountCapped ? `${state.matchCount}+` : `${state.matchCount}`;
        elements.countLabel.textContent = state.matchCount > 0 ? `${state.currentIndex + 1}/${total}` : "0/0";
      }

      applyDisabledStates();
    },

    setAvailability(nextAvailability: TextSearchAvailability): void {
      availability = nextAvailability;
      elements.input.placeholder = PLACEHOLDER_BY_AVAILABILITY[nextAvailability];
      if (nextAvailability !== "ready") {
        elements.countLabel.hidden = true;
      }
      applyDisabledStates();
    },

    focusInput(): void {
      elements.input.focus();
      elements.input.select();
    },

    isAvailable(): boolean {
      return availability === "ready";
    }
  };
}
